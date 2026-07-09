# Healthcare & Pharmacy

## Who this is for

Independent pharmacies, compounding pharmacies, medical clinics with dispensing, and health & wellness retail with prescription management.

## Activated modules

| Module | What it does |
|---|---|
| Prescriptions | Rx records, refill tracking, dispense workflow |
| Patient Records | Patient profiles, allergy tracking, medical history |
| Insurance | Insurance plan association (manual claims) |
| Expiry Tracking | Batch tracking and expiry alerts for medications |

## Patients

Location: `/healthcare`

Patient profiles hold:
- Name, DOB, contact info
- Known allergies (shown as a red alert at dispense time)
- Active prescriptions
- Dispense history

## Prescriptions

Each prescription record holds:
- Drug name and strength
- Prescriber name
- Date written and expiry date
- Refills authorized / refills remaining
- Instructions (SIG)

### Dispensing a prescription

1. Open the patient record → **Prescriptions** tab
2. Click **Dispense** on the active prescription
3. System checks: not expired, refills remaining > 0
4. If the patient has allergies relevant to the drug, a warning banner appears — cashier must acknowledge
5. Dispense decrements `refills_remaining` by 1
6. If `refills_remaining` drops to 0, the prescription is flagged as exhausted (409 error on further dispense attempts)

### Refill workflow

When a prescription needs renewal:
1. Contact the prescriber for a new Rx
2. Create a new prescription record in Ascend (previous one stays in history)

## Allergy alerts

Allergy data is stored on the patient record. During dispense, if the drug matches a flagged allergen category, a full-screen red alert is shown. The cashier must explicitly confirm they have reviewed it before proceeding.

## Expiry tracking

All medication inventory uses batch tracking:
- Enable **Expiry tracking** on the product in Catalog
- When receiving, enter batch number and expiry date
- Ascend warns at dispense if the batch is within 30 days of expiry or already expired
- **Inventory → Expiring soon** shows medications expiring within 30 days

## Compliance notes

Ascend is a business management tool, not a certified pharmacy management system (PMS). For DEA Schedule II–V controlled substances, consult your jurisdiction's requirements. A certified PMS with DEA integration may be required in addition to Ascend for controlled substance management.
