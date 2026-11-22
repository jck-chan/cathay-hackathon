let clicks = 0;
document.querySelector('#brand-mark').addEventListener('click', () => {
  clicks += 1;
  if (clicks === 15) {
    clicks = 0;
    window.open('/cockpit', '_blank', 'noopener');
  }
});
