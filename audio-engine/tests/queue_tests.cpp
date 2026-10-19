#include "../playlist/QueueManager.h"

#include <cassert>
#include <string>
#include <vector>

using namespace twilight::audio;

namespace {

const char* kQueueJson =
    "[{\"id\":\"a\",\"audioSource\":\"a.flac\",\"duration\":1.5},"
    "{\"id\":\"b\",\"source\":\"b.flac\",\"duration\":2.5},"
    "{\"id\":\"c\",\"filePath\":\"c.flac\",\"duration\":3.5}]";

void testLoadAndUpcoming() {
  QueueManager queue;
  std::string error;
  assert(queue.loadFromJson(kQueueJson, 1, &error));
  assert(queue.currentIndex() == 1);
  assert(queue.current()->source == "b.flac");
  assert(queue.upcoming()->source == "c.flac");
  assert(queue.upcomingJson().find("\"source\":\"c.flac\"") != std::string::npos);
}

void testSequentialAdvanceStopsAtQueueEnd() {
  QueueManager queue;
  std::string error;
  assert(queue.loadFromJson(kQueueJson, 2, &error));
  auto next = queue.advanceAfterEnd();
  assert(!next);
  assert(queue.currentIndex() == 2);
  assert(!queue.upcoming());
  assert(queue.upcomingJson() == "null");
}

void testSequentialManualNextStillWraps() {
  QueueManager queue;
  std::string error;
  assert(queue.loadFromJson(kQueueJson, 2, &error));
  auto next = queue.next();
  assert(next);
  assert(queue.currentIndex() == 0);
  assert(next->source == "a.flac");
}

void testRepeatAdvanceKeepsCurrentTrack() {
  QueueManager queue;
  std::string error;
  assert(queue.loadFromJson(kQueueJson, 1, &error));
  queue.setPlayMode(PlayMode::Repeat);
  auto next = queue.advanceAfterEnd();
  assert(next);
  assert(queue.currentIndex() == 1);
  assert(next->source == "b.flac");
}

void testRepeatManualNextUsesPlaylistOrder() {
  QueueManager queue;
  std::string error;
  assert(queue.loadFromJson(kQueueJson, 1, &error));
  queue.setPlayMode(PlayMode::Repeat);
  auto next = queue.next();
  assert(next);
  assert(queue.currentIndex() == 2);
  assert(next->source == "c.flac");
  auto previous = queue.previous();
  assert(previous);
  assert(queue.currentIndex() == 1);
  assert(previous->source == "b.flac");
}

void testAddRemoveAndInvalidInput() {
  QueueManager queue;
  std::string error;
  assert(!queue.loadFromJson("{\"source\":\"bad.flac\"}", 0, &error));
  assert(queue.empty());
  assert(queue.addFromJson("{\"source\":\"one.flac\"}", &error));
  assert(queue.addFromJson("{\"streamUrl\":\"two.flac\"}", &error));
  assert(queue.currentIndex() == 0);
  assert(queue.removeAt(0));
  assert(queue.currentIndex() == 0);
  assert(queue.current()->source == "two.flac");
  assert(!queue.removeAt(4));
}

void testSingleFileCueRangesKeepDistinctQueueIdentity() {
  QueueManager queue;
  std::string error;
  const char* cueQueue =
      "[{\"id\":\"cue-1\",\"source\":\"disc.flac\",\"duration\":60,"
      "\"cueRange\":{\"startSeconds\":0,\"endSeconds\":60,\"pregapSeconds\":0},"
      "\"replayGainTrackGainDb\":-3},"
      "{\"id\":\"cue-2\",\"source\":\"disc.flac\",\"duration\":58,"
      "\"cueRange\":{\"startSeconds\":60,\"endSeconds\":118,\"pregapSeconds\":2,"
      "\"virtualPregapSeconds\":2,\"sourcePregapSeconds\":1.5},"
      "\"replayGainTrackGainDb\":-9}]";
  assert(queue.loadFromJson(cueQueue, 1, &error));
  assert(queue.currentIndex() == 1);
  const auto current = queue.current();
  assert(current);
  assert(current->source == "disc.flac");
  assert(current->cueStartSeconds && *current->cueStartSeconds == 60.0);
  assert(current->cueEndSeconds && *current->cueEndSeconds == 118.0);
  assert(current->cuePregapSeconds == 2.0);
  assert(current->cueVirtualPregapSeconds == 2.0);
  assert(current->cueSourcePregapSeconds == 1.5);
  assert(current->replayGainTrackGainDb && *current->replayGainTrackGainDb == -9.0);
  const std::string serialized = QueueManager::itemToJson(current);
  assert(serialized.find("\"cueStartSeconds\":60") != std::string::npos);
  assert(serialized.find("\"cueEndSeconds\":118") != std::string::npos);
  assert(serialized.find("\"cuePregapSeconds\":2") != std::string::npos);
  assert(serialized.find("\"cueVirtualPregapSeconds\":2") != std::string::npos);
  assert(serialized.find("\"cueSourcePregapSeconds\":1.5") != std::string::npos);
  QueueManager reloaded;
  assert(reloaded.loadFromJson("[" + serialized + "]", 0, &error));
  assert(reloaded.current()->cueStartSeconds && *reloaded.current()->cueStartSeconds == 60.0);
}

void testMalformedCueRangesFailClosedInsteadOfBecomingWholeFilePlayback() {
  QueueManager queue;
  std::string error;
  assert(!queue.loadFromJson(
      "[{\"source\":\"disc.flac\",\"cueRange\":{\"startSeconds\":60,\"endSeconds\":20,"
      "\"pregapSeconds\":-1}}]",
      0,
      &error));
  assert(queue.empty());
  assert(error.find("CUE range") != std::string::npos);
  assert(!queue.addFromJson("{\"source\":\"disc.flac\",\"cueRange\":null}", &error));
  assert(!queue.loadFromJson(
      "[{\"source\":\"disc.flac\",\"cueRange\":{\"startSeconds\":0,\"endSeconds\":60,"
      "\"pregapSeconds\":\"2\"}}]",
      0,
      &error));
  assert(!queue.loadFromJson(
      "[{\"source\":\"disc.flac\",\"cueRange\":{\"note\":\"\\\"startSeconds\\\":0,"
      "\\\"endSeconds\\\":60\"}}]",
      0,
      &error));
  assert(!queue.loadFromJson(
      "[{\"source\":\"disc.flac\",\"cueRange\":{\"startSeconds\":1e9999,\"endSeconds\":60}}]",
      0,
      &error));
  assert(!queue.loadFromJson(
      "[{\"source\":\"disc.flac\",\"cueRange\":{\"startSeconds\":0oops,\"endSeconds\":60}}]",
      0,
      &error));
}

void testCueFieldsInsideUserStringsCannotForgeNativeRanges() {
  QueueManager queue;
  std::string error;
  assert(queue.loadFromJson(
      "[{\"source\":\"disc.flac\",\"title\":\"quoted \\\"startSeconds\\\":60,"
      "\\\"endSeconds\\\":120\"}]",
      0,
      &error));
  const auto current = queue.current();
  assert(current);
  assert(!current->cueStartSeconds);
  assert(!current->cueEndSeconds);
}

void testShuffleAddKeepsCurrentTrackStable() {
  QueueManager queue;
  std::string error;
  assert(queue.loadFromJson(kQueueJson, 1, &error));
  queue.setPlayMode(PlayMode::Shuffle);
  assert(queue.currentIndex() == 1);
  // Adding tracks must not reshuffle the current item out from under an
  // active playback session.
  for (int added = 0; added < 8; ++added) {
    const std::string item = "{\"source\":\"extra" + std::to_string(added) + ".flac\"}";
    assert(queue.addFromJson(item, &error));
    assert(queue.currentIndex() == 1);
    assert(queue.current()->source == "b.flac");
  }
}

void testListLoopAdvanceWrapsInsteadOfStopping() {
  QueueManager queue;
  std::string error;
  assert(queue.loadFromJson(kQueueJson, 2, &error));
  queue.setPlayMode(PlayMode::ListLoop);
  assert(queue.playModeId() == "listLoop");
  // Regression: auto-advance used to return nullopt on the last entry, so the
  // engine stopped and the host saw a jump cap equal to the queue length.
  auto next = queue.advanceAfterEnd();
  assert(next);
  assert(queue.currentIndex() == 0);
  assert(next->source == "a.flac");
  // Keep going well past one full pass — list loop has no jump budget at all.
  for (int advanced = 0; advanced < 10; ++advanced) {
    const auto item = queue.advanceAfterEnd();
    assert(item);
    assert(!item->source.empty());
  }
  assert(queue.currentIndex() == 10 % 3);
}

void testListLoopUpcomingWrapsForGaplessPreload() {
  QueueManager queue;
  std::string error;
  assert(queue.loadFromJson(kQueueJson, 2, &error));
  queue.setPlayMode(PlayMode::ListLoop);
  // The engine preloads upcoming(). Without wrapping here the last->first hop
  // would still lose gapless even though advanceAfterEnd() wraps.
  const auto upcoming = queue.upcoming();
  assert(upcoming);
  assert(upcoming->source == "a.flac");
  assert(queue.upcomingJson().find("\"source\":\"a.flac\"") != std::string::npos);
}

void testShuffleCycleWrapsWithoutReshuffling() {
  QueueManager queue;
  std::string error;
  assert(queue.loadFromJson(kQueueJson, 0, &error));
  queue.setPlayMode(PlayMode::Shuffle);
  // The host hands over an already-shuffled queue, so a shuffle cycle wraps in
  // place: the same order every cycle, never a fresh permutation mid-session.
  std::vector<std::string> firstCycle;
  firstCycle.push_back(queue.current()->source);
  for (int step = 0; step < 2; ++step) {
    const auto item = queue.advanceAfterEnd();
    assert(item);
    firstCycle.push_back(item->source);
  }
  const auto wrapped = queue.advanceAfterEnd();
  assert(wrapped);
  assert(wrapped->source == firstCycle.front());
  for (size_t step = 1; step < firstCycle.size(); ++step) {
    const auto item = queue.advanceAfterEnd();
    assert(item);
    assert(item->source == firstCycle[step]);
  }
}

void testPlayModeIdRoundTripsListLoop() {
  assert(QueueManager::parsePlayMode("listLoop") == PlayMode::ListLoop);
  assert(QueueManager::playModeToId(PlayMode::ListLoop) == "listLoop");
  // Ids this engine does not know still fail closed to sequential, so a host
  // newer than the shipped binary degrades instead of refusing the queue.
  assert(QueueManager::parsePlayMode("heart") == PlayMode::Sequential);
  assert(QueueManager::parsePlayMode("") == PlayMode::Sequential);
}

void testIdenticalContentMovesCursorWithoutChangingPolicy() {
  QueueManager queue;
  std::string error;
  assert(queue.loadFromJson(kQueueJson, 0, &error));
  queue.setPlayMode(PlayMode::Shuffle);
  queue.setCurrentIndex(1);
  const auto upcoming = queue.upcoming()->id;
  assert(queue.loadFromJson(kQueueJson, 1, &error));
  assert(queue.size() == 3);
  assert(queue.playMode() == PlayMode::Shuffle);
  assert(queue.current()->id == "b");
  assert(queue.upcoming()->id == upcoming);
  assert(queue.loadFromJson(kQueueJson, 99, &error));
  assert(queue.currentIndex() == 2);
  assert(queue.upcoming());
  const std::string invalid = "[{\"source\":\"disc.flac\",\"cueRange\":null}]";
  assert(!queue.loadFromJson(invalid, 0, &error));
  assert(!queue.loadFromJson(invalid, 0, &error));
}

}  // namespace

int main() {
  testLoadAndUpcoming();
  testSequentialAdvanceStopsAtQueueEnd();
  testSequentialManualNextStillWraps();
  testRepeatAdvanceKeepsCurrentTrack();
  testRepeatManualNextUsesPlaylistOrder();
  testListLoopAdvanceWrapsInsteadOfStopping();
  testListLoopUpcomingWrapsForGaplessPreload();
  testShuffleCycleWrapsWithoutReshuffling();
  testPlayModeIdRoundTripsListLoop();
  testIdenticalContentMovesCursorWithoutChangingPolicy();
  testAddRemoveAndInvalidInput();
  testShuffleAddKeepsCurrentTrackStable();
  testSingleFileCueRangesKeepDistinctQueueIdentity();
  testMalformedCueRangesFailClosedInsteadOfBecomingWholeFilePlayback();
  testCueFieldsInsideUserStringsCannotForgeNativeRanges();
  return 0;
}
