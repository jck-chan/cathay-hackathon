/* Reads canonical state; selection and network ownership remain in v9.js. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const text = (id, value) => { $(id).textContent = value; };
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
  const label = value => String(value || 'Pending').toLowerCase().replaceAll('_', ' ').replace(/^./, c => c.toUpperCase());
  const time = value => { const d = new Date(value); return value && !isNaN(d) ? d.toLocaleString('en-GB', {timeZone:'UTC', day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'}) + ' UTC' : 'Unavailable'; };
  function render(s, selected, globe) {
    const list = s.shipment_objects || [];
    const q = $('filterShipments').value.trim().toLowerCase();
    const shown = list.filter(x => `${x.awb} ${x.destination}`.toLowerCase().includes(q));
    text('portfolioCount', list.length);
    const html = shown.map(x => `<button type="button" class="shipment-card ${x.awb === selected ? 'active' : ''}" data-awb="${escape(x.awb)}" aria-pressed="${x.awb === selected}"><b>${escape(x.awb)}</b><p>${escape(x.origin || 'HKG')} → ${escape(x.destination)} · ${escape(label(x.handling))}</p><small>${x.blocked_reason || x.dimension_conflict || x.customs_hold ? 'Needs attention' : escape(label(x.ground_stage || x.stage_relay || 'Received'))}</small></button>`).join('') || `<div class="empty-card">${list.length ? 'No shipments match your search.' : 'No shipments yet. Create a shipment to begin.'}</div>`;
    // Avoid replacing focused buttons on every polling tick.
    if ($('portfolioItems').innerHTML !== html) {
      const focused = document.activeElement?.dataset.awb;
      $('portfolioItems').innerHTML = html;
      if (focused) [...$('portfolioItems').children].find(el => el.dataset.awb === focused)?.focus({preventScroll:true});
    }
    const item = list.find(x => x.awb === selected);
    const c = s.customer_projection?.awb === selected ? s.customer_projection : null;
    const route = item ? `${item.origin || 'HKG'} → ${item.destination}` : '— → —';
    text('shipAwb', selected || 'No shipment selected');
    text('shipRoute', route);
    $('fullJourney').disabled = !c;
    globe.setRoutes?.(list, selected);
    if (item && (globe.route[0] !== (item.origin || 'HKG') || globe.route[1] !== item.destination)) globe.setRoute(item.origin || 'HKG', item.destination);
    if (!c) {
      text('shipStatus', item ? 'Loading details' : 'No shipment');
      text('shipEta', 'Arrival estimate unavailable');
      text('journeySteps', item ? 'Loading shipment details' : 'Your portfolio is empty');
      return;
    }
    const rd = c.route_decision || {}, phase = c.ground_twin?.phase;
    text('shipStatus', label(c.status || 'Simulated'));
    text('shipEta', c.eta_past_due_without_arrival_confirmation ? 'Recorded ETA overdue · arrival not confirmed' : `Recorded arrival estimate: ${time(c.estimated_arrival_utc)}`);
    const serviceMessage = c.customer_service_message;
    const update = serviceMessage === 'Shipment milestones and estimated arrival are being updated.'
      ? ''
      : serviceMessage || c.journey_events?.at(-1)?.message;
    const proposals = rd.tentative_alternative_flights || [];
    const review = proposals.length ? label(rd.review_status || 'Awaiting review') : 'No alternative route proposed';
    const steps = [
      ['Request received', true, 'Shipment recorded in the simulation'],
      ['Ground processing', phase === 'DONE', c.ground_twin?.phase_label || label(phase || 'Not in staging'), update],
      ['Route review', false, review, proposals.length ? `Proposed route: ${proposals.join(' → ')}` : ''],
      ['Carrier confirmation', Boolean(rd.carrier_confirmed), rd.carrier_confirmed ? 'Confirmation recorded in the simulation' : 'Awaiting external confirmation']
    ];
    $('journeySteps').innerHTML = steps.map(([title, done, detail, note]) =>
      `<div class="stepnode ${done ? 'done' : ''}"><b>${title}</b><small>${escape(detail)}</small>${note ? `<small>${escape(note)}</small>` : ''}</div>`
    ).join('');
  }
  window.RELAY_CUSTOMER = {render};
})();
