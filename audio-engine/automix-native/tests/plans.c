#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "am_handoff.h"
#include "am_hash.h"
#include "am_plan.h"
#include "am_rhythm.h"
static void require(int ok, const char *s) {
  if (!ok) {
    fprintf(stderr, "FAIL: %s\n", s);
    exit(1);
  }
}
static void fixture(ta_am_features *f, double start, double end,
                    double duration) {
  memset(f, 0, sizeof(*f));
  f->start_seconds = start;
  f->end_seconds = end;
  f->duration_seconds = duration;
  f->bpm = 120;
  f->tempo_confidence = 0.9f;
  f->rms_db = -12;
  f->peak = 0.4f;
  f->key = -1;
  for (double t = start; t < end; t += 0.5)
    f->beats[f->beat_count++] = t;
  f->frame_count = (uint32_t)((end - start) * 50);
  for (unsigned i = 0; i < f->frame_count; i++) {
    f->frame_db[i] = -12;
    f->frame_peak[i] = 0.4f;
  }
  for (unsigned i = 0; i < 64; i++) {
    double pos = fmin(start + i * 0.48, end - 0.975);
    f->voice_start[i] = pos;
    f->voice_end[i] = pos + 0.975;
    f->voice[i] = 0.001f;
    f->music[i] = 0.9f;
    f->voice_count++;
    if (f->voice_end[i] >= end - 1e-8)
      break;
  }
}
int main(void) {
  char hex[65];
  ta_am_sha256("abc", 3, hex);
  require(
      !strcmp(
          hex,
          "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"),
      "SHA-256 abc");
  ta_am_sha256("", 0, hex);
  require(
      !strcmp(
          hex,
          "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"),
      "SHA-256 empty");
  /* Feature fixtures are large; keep them off the MSVC default 1 MiB stack. */
  static ta_am_features a, b;
  fixture(&a, 60, 90, 90);
  fixture(&b, 0, 30, 90);
  require(ta_am_features_valid(&b), "feature fixture valid");
  b.downbeats[0] = NAN;
  b.downbeat_count = 1;
  require(!ta_am_features_valid(&b), "invalid downbeat rejected");
  b.downbeat_count = 0;
  b.voice_start[2] = b.voice_end[1] + 0.1;
  require(ta_am_voice_between(&b, 0, 2, 0) < 0,
          "voice coverage gap remains unknown");
  fixture(&b, 0, 30, 90);
  ta_am_binding binding = {0};
  binding.sample_rate = 8000;
  binding.channels = 2;
  binding.queue_revision = 23;
  binding.playback_generation = 10;
  binding.plan_id = 1;
  memset(binding.current_identity, 'a', 64);
  memset(binding.next_identity, 'b', 64);
  ta_am_plan_spec natural, dj, again;
  char reason[128];
  require(ta_am_select(&a, &b, TA_AM_NATURAL, &binding, &natural, reason,
                       sizeof(reason)) == 1,
          reason);
  require(ta_am_select(&a, &b, TA_AM_NATURAL, &binding, &again, reason,
                       sizeof(reason)) == 1 &&
              !memcmp(&natural, &again, sizeof(natural)),
          "deterministic ranking");
  require(natural.output_frames >= 32000 && natural.output_frames <= 64000 &&
              natural.effect == TA_AM_CLEAN,
          "natural policy");
  static ta_am_features short_tail;
  short_tail = a;
  short_tail.duration_seconds += .012;
  require(ta_am_select(&short_tail, &b, TA_AM_NATURAL, &binding, &again, reason,
      sizeof(reason)) == 1 && again.current_end <= 90 * binding.sample_rate,
      "codec tail deficit never extrapolates analysis or consumes absent PCM");
  short_tail.duration_seconds += .03;
  require(ta_am_select(&short_tail, &b, TA_AM_NATURAL, &binding, &again, reason,
      sizeof(reason)) == 0 && !strcmp(reason, "incomplete_boundary_coverage"),
      "larger missing tail remains incomplete instead of a valid boundary");
  require(ta_am_select(&a, &b, TA_AM_DJ, &binding, &dj, reason,
                       sizeof(reason)) == 1 &&
              dj.effect == TA_AM_ECHO,
          "confident instrumental DJ effect");
  b.voice[0] = 0.9f;
  require(ta_am_select(&a, &b, TA_AM_DJ, &binding, &again, reason,
                       sizeof(reason)) == 1 &&
              again.effect == TA_AM_CLEAN,
          "voice blocks conspicuous effects");
  b.voice[0] = 0.001f;
  a.tempo_confidence = 0.1f;
  require(ta_am_select(&a, &b, TA_AM_NATURAL, &binding, &again, reason,
                       sizeof(reason)) == 1 && again.confidence > .9f,
          "local stable evidence survives low whole-window confidence");
  unsigned saved_beats = a.beat_count;
  a.beat_count = 6;
  require(ta_am_select(&a, &b, TA_AM_NATURAL, &binding, &again, reason,
                       sizeof(reason)) == 0 &&
              !strcmp(reason, "low_beat_confidence"),
          "insufficient local evidence remains unknown");
  a.beat_count = saved_beats;
  a.tempo_confidence = 0.9f;
  b.bpm = 180;
  b.beat_count = 0;
  for (double t = 0; t < 30; t += 1. / 3) b.beats[b.beat_count++] = t;
  require(ta_am_select(&a, &b, TA_AM_NATURAL, &binding, &again, reason,
                       sizeof(reason)) == 0,
          "rate bounds");
  b.bpm = 120;
  fixture(&b, 1, 30, 90);
  require(ta_am_select(&a, &b, TA_AM_NATURAL, &binding, &again, reason,
                       sizeof(reason)) == 0,
          "partial coverage never full");
  fixture(&b, 0, 30, 90);
  for (int cpu = TA_AM_C; cpu <= TA_AM_AVX2; cpu++) {
    const ta_am_kernels *k = ta_am_get_kernels((ta_am_cpu)cpu);
    if (!k) continue;
    static ta_am_features quantised;
    quantised = b;
    quantised.beat_count = 0;
    for (unsigned i = 0; i < 80; i++)
      quantised.beats[quantised.beat_count++] = round(i * .375 * 50) / 50;
    ta_am_rhythm rhythm;
    require(ta_am_rhythm_region(&quantised, 0, 30, k, &rhythm) &&
        fabsf(rhythm.bpm - 160) < .02f && rhythm.confidence > .8f,
        "50-fps timestamps use fitted tempo rather than median interval");
    for (unsigned i = 0; i < 80; i++)
      quantised.beats[i] = i * .375 + (i % 2 ? .16 : 0);
    require(!ta_am_rhythm_region(&quantised, 0, 30, k, &rhythm),
        "irregular events cannot become a reliable grid");
  }
  static ta_am_features double_time;
  double_time = b;
  double_time.bpm = 240;
  double_time.beat_count = 0;
  for (double t = 0; t < 30; t += .25) double_time.beats[double_time.beat_count++] = t;
  require(ta_am_select(&a, &double_time, TA_AM_DJ, &binding, &again, reason,
      sizeof(reason)) == 1 && again.current_rate == 1 && again.next_rate == 1,
      "half/double beat correspondence keeps audio speed unchanged");
  ta_am_plan_spec boundary_reference = {0};
  for (int cpu = TA_AM_C; cpu <= TA_AM_AVX2; cpu++) {
    const ta_am_kernels *k = ta_am_get_kernels((ta_am_cpu)cpu);
    if (!k) continue;
    static ta_am_features fade, intro;
    fade = a;
    intro = b;
    fade.beat_count = intro.beat_count = 0;
    require(ta_am_select_with_kernels(&fade, &intro, TA_AM_NATURAL, &binding,
        k, &again, reason, sizeof(reason)) == 0,
        "flat beatless music keeps normal playback");
    for (unsigned i = fade.frame_count - 50; i < fade.frame_count; i++) {
      fade.frame_db[i] = -90;
      // Not confirmed silence: envelope evidence must work independently.
      fade.frame_peak[i] = .0003f;
    }
    require(ta_am_select_with_kernels(&fade, &intro, TA_AM_NATURAL, &binding,
        k, &again, reason, sizeof(reason)) == 1 &&
        again.kind == TA_AM_CONTENT_BOUNDARY && again.bpm == 0 &&
        again.confidence == 0 && again.effect == TA_AM_CLEAN &&
        again.current_rate == 1 && again.next_rate == 1 &&
        ta_am_plan_valid(&again, k),
        "measured instrumental decay has no fabricated beat confidence");
    if (cpu == TA_AM_C) boundary_reference = again;
    else require(!memcmp(&again, &boundary_reference, sizeof(again)),
        "content boundary ranking and frames agree across CPUs");
    ta_am_plan_spec wrong_kind = again;
    wrong_kind.kind = TA_AM_BEAT_ALIGNED;
    require(!ta_am_plan_valid(&wrong_kind, k), "unknown tempo cannot claim beat alignment");
    wrong_kind = again; wrong_kind.mode = TA_AM_DJ;
    require(ta_am_plan_valid(&wrong_kind, k), "DJ permits verified original-speed fallback");
    require(ta_am_select_with_kernels(&fade, &intro, TA_AM_DJ, &binding,
        k, &again, reason, sizeof(reason)) == 1 && again.kind == TA_AM_CONTENT_BOUNDARY && again.mode == TA_AM_DJ,
        "DJ falls back to verified instrumental decay");
    intro.voice_count = 0;
    require(ta_am_select_with_kernels(&fade, &intro, TA_AM_NATURAL, &binding,
        k, &again, reason, sizeof(reason)) == 0,
        "unknown voice activity cannot certify instrumental boundary");
    intro = b; intro.beat_count = 0;
    for (unsigned i = 0; i < intro.voice_count; i++) intro.voice[i] = .9f;
    require(ta_am_select_with_kernels(&fade, &intro, TA_AM_NATURAL, &binding,
        k, &again, reason, sizeof(reason)) == 0, "vocal intro retains full content");
    intro = b; intro.beat_count = 0;
    for (unsigned i = 0; i < intro.voice_count; i++) intro.music[i] = 0;
    require(ta_am_select_with_kernels(&fade, &intro, TA_AM_NATURAL, &binding,
        k, &again, reason, sizeof(reason)) == 0, "nonmusic intro cannot certify boundary");
    intro = b; intro.beat_count = 0;
    fade = a; fade.beat_count = 0;
    for (unsigned i = fade.frame_count - 40; i < fade.frame_count; i++) {
      fade.frame_db[i] = -100; fade.frame_peak[i] = 0;
    }
    for (unsigned i = 0; i < 20; i++) {
      intro.frame_db[i] = -100; intro.frame_peak[i] = 0;
    }
    require(ta_am_select_with_kernels(&fade, &intro, TA_AM_NATURAL, &binding,
        k, &again, reason, sizeof(reason)) == 1 &&
        again.current_end == 713600 && again.next_start == 3200 &&
        again.next_end == again.next_start + again.output_frames,
        "confirmed silence trims only silent frames with exact continuation");
    ta_am_binding oversized = binding;
    oversized.sample_rate = 384000; oversized.channels = 8;
    require(ta_am_select_with_kernels(&fade, &intro, TA_AM_NATURAL, &oversized,
        k, &again, reason, sizeof(reason)) == 0,
        "content candidates obey preparation memory cap");
  }

  {
    ta_am_features* tail = calloc(1, sizeof(*tail)), *head = calloc(1, sizeof(*head));
    require(tail && head, "extended features allocated");
    for (unsigned d = 0; d < 2; d++) {
      ta_am_features* f = d ? head : tail;
      f->start_seconds = d ? 0 : 200; f->end_seconds = d ? 60 : 300; f->duration_seconds = 300;
      f->bpm = 120; f->tempo_confidence = .95f; f->rms_db = -12; f->peak = .4f; f->key = -1;
      f->frame_count = (unsigned)((f->end_seconds - f->start_seconds) * 50);
      f->spectral_count = f->frame_count;
      for (unsigned i = 0; i < f->frame_count; i++) {
        f->frame_db[i] = -12; f->frame_peak[i] = .4f; f->frame_low_db[i] = -18; f->frame_onset[i] = (i % 25 == 0) * 6;
      }
      for (double t = f->start_seconds; t < f->end_seconds; t += .5) f->beats[f->beat_count++] = t;
      for (double t = f->start_seconds; t < f->end_seconds; t += 2) f->downbeats[f->downbeat_count++] = t;
      f->voice_count = 1; f->voice_start[0] = f->start_seconds; f->voice_end[0] = f->end_seconds;
      f->voice[0] = .001f; f->music[0] = .99f;
    }
    ta_am_plan_spec reference;
    for (int cpu = TA_AM_C; cpu <= TA_AM_AVX2; cpu++) {
      const ta_am_kernels* k = ta_am_get_kernels((ta_am_cpu)cpu); if (!k) continue;
      require(ta_am_select_after(tail, head, TA_AM_DJ, &binding, k, 250 * 8000, &again, reason, sizeof(reason)) == 1,
          "extended DJ phrase selected");
      require(again.output_frames >= 16 * 8000 && again.output_frames <= 32 * 8000 &&
          again.current_start >= 250 * 8000 && again.next_start <= 20 * 8000 && again.current_end >= 240 * 8000 &&
          again.current_rate >= .88 && again.current_rate <= 1.12 && again.next_rate >= .88 && again.next_rate <= 1.12,
          "DJ phrase crop duration and tempo limits");
      if (cpu == TA_AM_C) reference = again;
      else require(!memcmp(&reference, &again, sizeof(again)), "extended candidates agree across C SSE2 AVX2");
      require(ta_am_select_after(tail, head, TA_AM_DJ, &binding, k, 299 * 8000, &again, reason, sizeof(reason)) == 0,
          "no late ticket when commit reserve is unavailable");
    }
    free(tail); free(head);
  }

  {
    ta_am_features *fade = malloc(sizeof(*fade)), *intro = malloc(sizeof(*intro));
    require(fade && intro, "boundary regressions allocated");
    *fade = a; *intro = b; fade->beat_count = intro->beat_count = 0;
    for (unsigned i = fade->frame_count - 500; i < fade->frame_count; i++) {
      fade->frame_db[i] = -100; fade->frame_peak[i] = 0;
    }
    require(ta_am_select(fade, intro, TA_AM_NATURAL, &binding, &again, reason, sizeof(reason)) == 1 &&
        again.current_end == 80 * binding.sample_rate,
        "ten-second verified silence is not capped to three seconds");
    *fade = a;
    fade->beat_count = 0;
    for (unsigned i = fade->frame_count - 50; i < fade->frame_count; i++) {
      fade->frame_db[i] = -90; fade->frame_peak[i] = .0003f;
    }
    intro->music[0] = 0;
    for (unsigned i = 0; i < 50; i++) intro->frame_db[i] = -70;
    require(ta_am_select(fade, intro, TA_AM_NATURAL, &binding, &again, reason, sizeof(reason)) == 1,
        "quiet fade-in does not veto later measured musical activity");
    require(ta_am_select_after(fade, intro, TA_AM_NATURAL, &binding, ta_am_get_kernels(TA_AM_C),
        88 * binding.sample_rate, &again, reason, sizeof(reason)) == 1 &&
        again.current_start >= 88 * binding.sample_rate && again.output_frames == 2 * binding.sample_rate,
        "live commit reserve searches a shorter still-safe candidate");
    fade->voice_count = intro->voice_count = 2;
    fade->voice_start[0] = 60; fade->voice_end[0] = 86; fade->voice[0] = .6f;
    fade->voice_start[1] = 86; fade->voice_end[1] = 90; fade->voice[1] = .001f;
    intro->voice_start[0] = 0; intro->voice_end[0] = 4; intro->voice[0] = .001f;
    intro->voice_start[1] = 4; intro->voice_end[1] = 30; intro->voice[1] = .5f;
    fade->music[0] = fade->music[1] = intro->music[0] = intro->music[1] = .9f;
    require(ta_am_select(fade, intro, TA_AM_NATURAL, &binding, &again, reason, sizeof(reason)) == 1 &&
        again.kind == TA_AM_CONTENT_BOUNDARY && again.current_rate == 1 && again.next_rate == 1,
        "nonoverlapping final and initial words permit original-speed handoff");
    fade->voice[1] = .6f;
    require(ta_am_select(fade, intro, TA_AM_NATURAL, &binding, &again, reason, sizeof(reason)) == 0,
        "late outgoing words cannot be hidden by content-boundary fading");
    *fade = a; *intro = b;
    fade->beat_count = intro->beat_count = 0;
    for (double t = 60; t < 90; t += 60. / 172) fade->beats[fade->beat_count++] = t;
    for (double t = 0; t < 30; t += 60. / 136) intro->beats[intro->beat_count++] = t;
    require(ta_am_select(fade, intro, TA_AM_DJ, &binding, &again, reason, sizeof(reason)) == 1 &&
        again.current_rate >= .88f && again.current_rate <= 1.12f &&
        again.next_rate >= .88f && again.next_rate <= 1.12f,
        "feasible asymmetric speeds survive a geometric-mean target outside the limit");
    free(fade); free(intro);
  }
  size_t count = 240000;
  float *x = malloc(count * 2 * 4), *y = malloc(count * 2 * 4),
        *mix = malloc((size_t)natural.output_frames * 2 * 4);
  require(x && y && mix, "allocation");
  for (size_t i = 0; i < count * 2; i++) {
    x[i] = 0.2f * (float)sin(i * 0.173);
    y[i] = 0.15f * (float)cos(i * 0.179);
  }
  ta_am_prepared *p =
      ta_am_prepare(&natural, x, count, 480000, y, count, 0,
                    ta_am_get_kernels(TA_AM_AUTO), reason, sizeof(reason));
  require(p != NULL, reason);
  ta_am_handoff handoff = {0};
  ta_am_handoff_span span;
  require(
      !ta_am_handoff_begin(&handoff, p, &binding, natural.current_start + 1),
      "late plan rejected");
  require(ta_am_handoff_begin(&handoff, p, &binding, natural.current_start),
          "handoff begins at exact source frame");
  require(!ta_am_handoff_peek(&handoff, &binding, 333, 1, &span) &&
              !handoff.output_frame,
          "pause freezes handoff");
  for (unsigned field = 0; field < 8; field++) {
    ta_am_binding stale = binding;
    switch (field) {
    case 0:
      stale.plan_id++;
      break;
    case 1:
      stale.queue_revision++;
      break;
    case 2:
      stale.playback_generation++;
      break;
    case 3:
      stale.format_revision++;
      break;
    case 4:
      stale.sample_rate++;
      break;
    case 5:
      stale.channels++;
      break;
    case 6:
      stale.current_identity[0] = 'f';
      break;
    case 7:
      stale.next_identity[0] = 'f';
      break;
    }
    require(!ta_am_handoff_peek(&handoff, &stale, 333, 0, &span),
            "stale handoff consumes nothing");
  }
  unsigned promotions = 0;
  while (ta_am_handoff_peek(&handoff, &binding, 333, 0, &span)) {
    promotions += ta_am_handoff_commit(&handoff, &span);
    require(!ta_am_handoff_commit(&handoff, &span),
            "duplicate span cannot advance or promote");
  }
  require(promotions == 1 && handoff.source_frame[1] == natural.next_end &&
              handoff.source_frame[0] == natural.current_end,
          "single promotion, exact continuation");
  ta_am_handoff_cancel(&handoff);
  require(ta_am_handoff_begin(&handoff, p, &binding, natural.current_start),
          "restart after cancel");
  require(ta_am_handoff_peek(&handoff, &binding, 997, 0, &span) == 997,
          "cancellation test span");
  ta_am_handoff_commit(&handoff, &span);
  uint64_t cancellation_clock = handoff.source_frame[0];
  ta_am_handoff_cancel(&handoff);
  require(handoff.source_frame[0] == cancellation_clock &&
              !ta_am_handoff_peek(&handoff, &binding, 333, 0, &span),
          "cancel preserves consumed source position");
  require(ta_am_prepared_bytes(p) < 128u * 1024 * 1024, "buffer cap");
  const float *left = ta_am_prepared_lane(p, 0),
              *right = ta_am_prepared_lane(p, 1);
  ta_am_prepared_mix(p, 0, left, right, mix, (size_t)natural.output_frames);
  require(fabsf(mix[0] - left[0]) < 1e-6f, "current at entry");
  size_t last = ((size_t)natural.output_frames - 1) * 2;
  require(fabsf(mix[last] - right[last]) < 1e-6f, "next at exit");
  require(ta_am_plan_source_frame(&natural, 1, (double)natural.output_frames) ==
              natural.next_end,
          "handoff uses mapped next source");
  ta_am_plan_spec invalid = natural;
  invalid.next_gain = NAN;
  require(ta_am_prepare(&invalid, x, count, 480000, y, count, 0,
                        ta_am_get_kernels(TA_AM_AUTO), reason,
                        sizeof(reason)) == NULL,
          "non-finite preparation rejected");
  ta_am_prepared_free(p);
  require(ta_am_plan_valid(&natural, ta_am_get_kernels(TA_AM_C)),
          "mapped plan valid");
  invalid = natural;
  invalid.current_end++;
  require(!ta_am_plan_valid(&invalid, ta_am_get_kernels(TA_AM_C)),
          "source endpoint must match integral");
  invalid = natural;
  invalid.mode = TA_AM_OFF;
  require(!ta_am_plan_valid(&invalid, ta_am_get_kernels(TA_AM_C)),
          "off cannot prepare a plan");
  invalid = natural;
  invalid.current_rate = 1.08f;
  require(!ta_am_plan_valid(&invalid, ta_am_get_kernels(TA_AM_C)),
          "natural enforces four percent");
  ta_am_cancel *cancel = ta_am_cancel_create();
  require(cancel != NULL, "cancel allocation");
  ta_am_cancel_request(cancel);
  require(!ta_am_prepare_cancelled(&natural, x, count, 480000, y, count, 0,
                                   ta_am_get_kernels(TA_AM_C), cancel, reason,
                                   sizeof(reason)) &&
              !strcmp(reason, "preparation_cancelled"),
          "cancel before preparation");
  ta_am_cancel_free(cancel);
  for (int cpu = TA_AM_C; cpu <= TA_AM_AVX2; cpu++) {
    const ta_am_kernels *k = ta_am_get_kernels((ta_am_cpu)cpu);
    if (!k)
      continue;
    require(ta_am_select_with_kernels(&a, &b, TA_AM_DJ, &binding, k, &again,
                                      reason, sizeof(reason)) == 1 &&
                !memcmp(&again, &dj, sizeof(dj)),
            "ranking and source frame boundaries by forced CPU");
  }
  for (int effect = TA_AM_CLEAN; effect <= TA_AM_REPEAT; effect++) {
    ta_am_plan_spec test = dj;
    test.effect = (ta_am_effect)effect;
    test.current_rate = 0.93f;
    test.next_rate = 1.07f;
    const ta_am_kernels *refK = ta_am_get_kernels(TA_AM_C);
    test.current_end = (uint64_t)llround(refK->source_at(
        (double)test.current_start, test.current_rate, 1,
        (size_t)test.output_frames, (double)test.output_frames));
    test.next_end = (uint64_t)llround(refK->source_at(
        (double)test.next_start, test.next_rate, 1, (size_t)test.output_frames,
        (double)test.output_frames));
    ta_am_prepared *reference = ta_am_prepare(&test, x, count, 480000, y, count,
                                              0, refK, reason, sizeof(reason));
    require(reference != NULL, reason);
    size_t samples = (size_t)test.output_frames * 2;
    float *referenceMix = malloc(samples * sizeof(float)),
          *actualMix = malloc(samples * sizeof(float));
    require(referenceMix && actualMix, "effect mix allocations");
    ta_am_prepared_mix(reference, 0, ta_am_prepared_lane(reference, 0),
                       ta_am_prepared_lane(reference, 1), referenceMix,
                       (size_t)test.output_frames);
    require(referenceMix[0] == x[(test.current_start - 480000) * 2] &&
        referenceMix[samples - 2] == y[(test.next_end - 1) * 2],
        "tempo-changing/effected mix rejoins real decoded source phase");
    for (int cpu = TA_AM_SSE2; cpu <= TA_AM_AVX2; cpu++) {
      const ta_am_kernels *k = ta_am_get_kernels((ta_am_cpu)cpu);
      if (!k)
        continue;
      ta_am_prepared *actual = ta_am_prepare(&test, x, count, 480000, y, count,
                                             0, k, reason, sizeof(reason));
      require(actual != NULL, reason);
      ta_am_prepared_mix(actual, 0, ta_am_prepared_lane(actual, 0),
                         ta_am_prepared_lane(actual, 1), actualMix,
                         (size_t)test.output_frames);
      for (size_t i = 0; i < samples; i++)
        if (!isfinite(actualMix[i]) ||
            fabsf(referenceMix[i] - actualMix[i]) > 5e-5f) {
          fprintf(stderr, "FAIL effect %d CPU %d sample %zu: %g vs %g\n",
                  effect, cpu, i, referenceMix[i], actualMix[i]);
          exit(1);
        }
      ta_am_prepared_free(actual);
    }
    ta_am_prepared_free(reference);
    free(referenceMix);
    free(actualMix);
  }
  free(x);
  free(y);
  free(mix);
  ta_am_plan_spec hot = natural;
  hot.current_start = hot.next_start = 0;
  hot.current_rate = hot.next_rate = 1;
  hot.current_end = hot.next_end = hot.output_frames;
  hot.next_gain = 2;
  size_t hot_samples = (size_t)hot.output_frames * binding.channels;
  float *hot_pcm = malloc(hot_samples * sizeof(float)),
        *hot_mix = malloc(hot_samples * sizeof(float));
  require(hot_pcm && hot_mix, "headroom fixture allocation");
  for (size_t i = 0; i < hot_samples; i++) hot_pcm[i] = .8f;
  for (int cpu = TA_AM_C; cpu <= TA_AM_AVX2; cpu++) {
    const ta_am_kernels *k = ta_am_get_kernels((ta_am_cpu)cpu);
    if (!k) continue;
    p = ta_am_prepare(&hot, hot_pcm, (size_t)hot.output_frames, 0,
        hot_pcm, (size_t)hot.output_frames, 0, k, reason, sizeof(reason));
    require(p != NULL, reason);
    ta_am_prepared_mix(p, 0, ta_am_prepared_lane(p, 0),
        ta_am_prepared_lane(p, 1), hot_mix, (size_t)hot.output_frames);
    require(hot_mix[0] == .8f && hot_mix[hot_samples - 1] == .8f,
        "headroom keeps exact outgoing/incoming samples at joins");
    for (size_t i = binding.sample_rate / 100 * 2;
         i < hot_samples - binding.sample_rate / 100 * 2; i++)
      require(hot_mix[i] <= .980001f && isfinite(hot_mix[i]),
          "correlated full-level decks and gain correction cannot overload the overlap");
    ta_am_prepared_free(p);
  }
  free(hot_pcm); free(hot_mix);
  /* Keep immutable plans alive until the aggregate budget refuses another,
   * then release them and prove that a new preparation can recover. */
  ta_am_prepared *held[160] = {0};
  size_t kept = 0;
  size_t budgetFrames = 64000;
  float *budgetPcm = calloc(budgetFrames * 2, sizeof(float));
  require(budgetPcm != NULL, "budget PCM");
  ta_am_plan_spec budgetSpec = natural;
  budgetSpec.current_start = budgetSpec.next_start = 0;
  budgetSpec.current_rate = budgetSpec.next_rate = 1;
  budgetSpec.output_frames = budgetSpec.current_end = budgetSpec.next_end =
      32000;
  while (kept < 160) {
    held[kept] = ta_am_prepare(
        &budgetSpec, budgetPcm, budgetFrames, 0, budgetPcm, budgetFrames, 0,
        ta_am_get_kernels(TA_AM_SSE2), reason, sizeof(reason));
    if (!held[kept])
      break;
    kept++;
  }
  require(kept > 0 && kept < 160 &&
              !strcmp(reason, "preparation_memory_budget"),
          "aggregate prepared memory is bounded");
  for (size_t i = 0; i < kept; i++)
    ta_am_prepared_free(held[i]);
  p = ta_am_prepare(&budgetSpec, budgetPcm, budgetFrames, 0, budgetPcm,
                    budgetFrames, 0, ta_am_get_kernels(TA_AM_SSE2), reason,
                    sizeof(reason));
  require(p != NULL, "released preparation budget is reusable");
  ta_am_prepared_free(p);
  free(budgetPcm);
  puts("PASS deterministic plans, voices, mode/rate limits, coverage, audio, "
       "mapping, budgets");
  return 0;
}
