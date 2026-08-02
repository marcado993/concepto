<script lang="ts">
  interface Props {
    text: string;
    speed?: number;
    startDelay?: number;
    tag?: "span" | "h1" | "p";
    class?: string;
  }

  let { text, speed = 26, startDelay = 0, tag = "span", class: className = "" }: Props = $props();

  let shown = $state("");
  let done = $state(false);

  $effect(() => {
    const full = text;
    shown = "";
    done = false;
    let intervalId: ReturnType<typeof setInterval> | undefined;

    const timeoutId = setTimeout(() => {
      let i = 0;
      intervalId = setInterval(() => {
        i++;
        shown = full.slice(0, i);
        if (i >= full.length) {
          clearInterval(intervalId);
          done = true;
        }
      }, speed);
    }, startDelay);

    return () => {
      clearTimeout(timeoutId);
      clearInterval(intervalId);
    };
  });
</script>

<svelte:element this={tag} class="type-text {className}">
  <span class="type-text-run">{shown}<span class="caret" class:idle={done}></span></span>
</svelte:element>

<style>
  .type-text {
    display: block;
  }

  .type-text-run {
    display: inline;
  }

  .caret {
    display: inline-block;
    width: 0.5em;
    height: 0.85em;
    margin-left: 2px;
    vertical-align: -0.12em;
    background: var(--accent);
    box-shadow: 0 0 8px var(--accent-glow);
    animation: blink 0.9s step-end infinite;
  }

  .caret.idle {
    animation: blink 1.1s step-end infinite;
    opacity: 0.6;
  }

  @keyframes blink {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0;
    }
  }
</style>
