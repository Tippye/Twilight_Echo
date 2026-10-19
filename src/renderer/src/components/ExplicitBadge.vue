<script setup lang="ts">
defineOptions({ name: 'ExplicitBadge' })
</script>

<template>
  <span class="explicit-badge" role="img" aria-label="Explicit 内容" title="Explicit 内容">E</span>
</template>

<style scoped>
.explicit-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 14px;
  height: 14px;
  border-radius: 2px;
  color: var(--te-card-bg);
  background: var(--te-neutral-500);
  font-family: var(--te-font-sans);
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0;
  vertical-align: middle;
}
</style>
