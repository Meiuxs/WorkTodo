export function readRecurringForm(form) {
  const recurring = form.elements.namedItem('recurring');
  if (!recurring?.checked) return null;
  const frequency = form.elements.namedItem('recurrenceFrequency').value;
  const interval = Number(form.elements.namedItem('recurrenceInterval').value);
  const recurrence = { frequency, interval };
  if (frequency === 'custom') {
    recurrence.unit = form.elements.namedItem('recurrenceUnit').value;
  }
  return { recurrence };
}
