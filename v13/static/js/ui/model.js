export function initModel(panel) {
  const papers = panel.querySelector('.model-options');
  const medicineJob = panel.querySelector('[data-medicine-job]');
  const medicineStatus = panel.querySelector('[data-medicine-status]');
  const petStatus = panel.querySelector('[data-pet-status]');
  const plan = panel.querySelector('[data-model-plan]');
  const reason = panel.querySelector('[data-model-why]');

  function updatePlan() {
    const ready = papers.querySelector(':checked').value === 'ready';
    medicineJob.textContent = ready ? 'Specialist crew · 8 points' : 'Specialist crew · Papers pending';
    medicineStatus.textContent = ready ? 'Load now' : 'Wait for papers';
    medicineStatus.toggleAttribute('data-waiting', !ready);
    petStatus.textContent = ready ? 'Wait for crew' : 'Load now';
    petStatus.toggleAttribute('data-waiting', ready);
    plan.textContent = ready ? 'Cold medicine + toy box · 13 points' : 'Pet carrier + toy box · 12 points';
    reason.textContent = ready
      ? 'The medicine gets the only specialist because it has more points. The other crew takes the toys.'
      : 'The medicine needs its papers first. The specialist can take the pet while the other crew takes the toys.';
  }

  papers.addEventListener('change', updatePlan);
  updatePlan();
  panel.querySelector('[data-model-evidence]').addEventListener('click', () => {
    const evidenceTab = document.querySelector('.tab[data-tab="evidence"]');
    evidenceTab.click();
    evidenceTab.focus();
  });
}
