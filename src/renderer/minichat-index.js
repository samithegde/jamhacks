const captionInset = window.minichat?.captionInset ?? 0;
if (captionInset > 0) {
  document.documentElement.style.setProperty(
    "--win-caption-inset",
    `${captionInset}px`
  );
}

const button = document.getElementById("minichat-button");

button?.addEventListener("click", () => {
  window.minichat?.restore?.();
});
