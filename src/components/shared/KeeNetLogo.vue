<script setup lang="ts">
/**
 * The KeeNet app mark: a centered key on a blue→cyan gradient squircle.
 * Mirrors public/favicon.svg. Size it with a class (e.g. `size-6`); the
 * gradient id is per-instance so multiple logos on one page don't collide.
 */
import { useId } from 'vue';

const gid = `keenet-logo-${useId()}`;
</script>

<template>
  <svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="KeeNet">
    <defs>
      <linearGradient :id="gid" x1="4" y1="4" x2="28" y2="28" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#4a90e2" />
        <stop offset="1" stop-color="#22d3ee" />
      </linearGradient>
    </defs>

    <!-- gradient squircle -->
    <rect width="32" height="32" rx="8" :fill="`url(#${gid})`" />

    <!-- key: bow + shaft + two teeth -->
    <g fill="#fff">
      <circle cx="16" cy="10.2" r="4.7" />
      <rect x="14.7" y="13" width="2.6" height="12.6" rx="1.3" />
      <rect x="17.3" y="20.4" width="2.9" height="1.9" rx="0.5" />
      <rect x="17.3" y="23.3" width="1.9" height="1.9" rx="0.5" />
    </g>

    <!-- bow hole punched to the gradient -->
    <circle cx="16" cy="10.2" r="2.3" :fill="`url(#${gid})`" />
  </svg>
</template>
