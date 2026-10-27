// Which customers a plan is for. A plan's "Available to" is everyone, FTTH only or FTTB only; a customer is FTTH when their category starts with
// Individual and FTTB when it starts with Business. A customer with some other category (or none) is offered every plan, and the plan a customer
// already has stays in the list so editing them never drops it.
export const kindOfCategory = (category) => (/^individual/i.test(category ?? '') ? 'ftth' : /^business/i.test(category ?? '') ? 'fttb' : null);

export const planFits = (plan, category, keepId = null) => {
  const audience = plan.audience ?? 'all';
  if (audience === 'all' || plan.id === keepId) return true;
  const kind = kindOfCategory(category);
  return !kind || kind === audience;
};

export const AUDIENCE_OPTIONS = [
  { value: 'all', label: 'Everyone' },
  { value: 'ftth', label: 'FTTH only (Individual)' },
  { value: 'fttb', label: 'FTTB only (Business)' },
];
export const audienceLabel = (a) => (a === 'ftth' ? 'FTTH' : a === 'fttb' ? 'FTTB' : 'Everyone');
