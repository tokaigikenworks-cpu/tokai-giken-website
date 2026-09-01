const MAX_TEXT = 5000;

const cleanText = (value, max = MAX_TEXT) => String(value ?? '').trim().slice(0, max);

function requiredText(value, field, max) {
  const result = cleanText(value, max);
  if (!result) throw new Error(`missing_required_field:${field}`);
  return result;
}

function money(value, field) {
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0) throw new Error(`invalid_money:${field}`);
  return result;
}

function positiveNumber(value, field) {
  const result = Number(value);
  if (!Number.isFinite(result) || result <= 0) throw new Error(`invalid_number:${field}`);
  return result;
}

function isoDateTime(value, field) {
  const text = requiredText(value, field, 64);
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) throw new Error(`invalid_datetime:${field}`);
  return date.toISOString();
}

export function createOrderTransfer(input, now = new Date()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('invalid_payload');
  if (cleanText(input.status, 30) !== '受注') throw new Error('contract_not_confirmed');

  const recordId = requiredText(input.record_id ?? input.recordId, 'record_id', 160);
  const acceptedAt = input.accepted_at ?? input.acceptedAt ?? now.toISOString();
  const customer = input.customer ?? {};
  const project = input.case ?? input.project ?? {};
  const estimate = input.estimate ?? {};
  const detailSource = Array.isArray(input.details) ? input.details : [];
  if (!detailSource.length) throw new Error('missing_required_field:details');

  const details = detailSource.map((row, index) => ({
    description: requiredText(row.description ?? row.item_name, `details[${index}].description`, 1000),
    quantity: positiveNumber(row.quantity, `details[${index}].quantity`),
    unit: requiredText(row.unit, `details[${index}].unit`, 40),
    unit_price: money(row.unit_price, `details[${index}].unit_price`),
    amount: money(row.amount, `details[${index}].amount`),
    note: cleanText(row.note, 1000)
  }));

  const subtotal = money(estimate.subtotal, 'estimate.subtotal');
  const taxAmount = money(estimate.tax_amount, 'estimate.tax_amount');
  const totalAmount = money(estimate.total_amount, 'estimate.total_amount');
  const detailTotal = details.reduce((sum, row) => sum + row.amount, 0);
  if (Math.abs(detailTotal - subtotal) > 1) throw new Error('amount_mismatch:details_vs_subtotal');
  if (Math.abs(subtotal + taxAmount - totalAmount) > 1) throw new Error('amount_mismatch:subtotal_tax_total');

  const phone = cleanText(customer.customer_phone, 80);
  const email = cleanText(customer.customer_email, 254).toLowerCase();
  if (!phone && !email) throw new Error('missing_required_field:customer_phone_or_email');

  return {
    schema_version: '1.0',
    source: {
      system: 'tokai-giken-estimate',
      record_id: recordId,
      accepted_at: isoDateTime(acceptedAt, 'accepted_at')
    },
    customer: {
      customer_type: cleanText(customer.customer_type, 40),
      customer_name: requiredText(customer.customer_name, 'customer.customer_name', 200),
      customer_contact_name: cleanText(customer.customer_contact_name, 120),
      customer_department: cleanText(customer.customer_department, 120),
      customer_postal_code: cleanText(customer.customer_postal_code, 20),
      customer_address: cleanText(customer.customer_address, 500),
      customer_phone: phone,
      customer_email: email,
      billing_name: cleanText(customer.billing_name, 200),
      payment_terms: cleanText(customer.payment_terms, 500)
    },
    case: {
      project_name: requiredText(project.project_name, 'case.project_name', 300),
      inquiry_summary: cleanText(project.inquiry_summary, 2000),
      requested_delivery_date: cleanText(project.requested_delivery_date, 100)
    },
    estimate: {
      estimate_number: requiredText(estimate.estimate_number, 'estimate.estimate_number', 100),
      estimate_date: requiredText(estimate.estimate_date, 'estimate.estimate_date', 40),
      subtotal,
      tax_amount: taxAmount,
      total_amount: totalAmount,
      note: cleanText(estimate.note, 3000)
    },
    details
  };
}

export async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
