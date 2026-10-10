const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://fuelsense.ng';

/**
 * JSON-LD describing the product in machine-readable form.
 *
 * Search engines use it for rich results; assistants use it to answer
 * questions about what FuelSense is without having to infer it from prose.
 * The claims here are deliberately the same ones the page makes in words,
 * including the limits: a product that overstates itself in structured data
 * gets quoted overstating itself.
 */
const GRAPH = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': `${SITE}/#organization`,
      name: 'FuelSense',
      url: SITE,
      email: 'uzochukwubenamara@gmail.com',
      areaServed: { '@type': 'Country', name: 'Nigeria' },
      description:
        'Fleet fuel intelligence for Nigerian operators, built on GPS telemetry.',
    },
    {
      '@type': 'WebSite',
      '@id': `${SITE}/#website`,
      url: SITE,
      name: 'FuelSense',
      publisher: { '@id': `${SITE}/#organization` },
      inLanguage: 'en-NG',
    },
    {
      '@type': 'SoftwareApplication',
      '@id': `${SITE}/#software`,
      name: 'FuelSense',
      applicationCategory: 'BusinessApplication',
      applicationSubCategory: 'Fleet management and fuel monitoring',
      operatingSystem: 'Web browser',
      url: SITE,
      publisher: { '@id': `${SITE}/#organization` },
      description:
        'FuelSense turns GPS tracker telemetry into auditable fuel cost: distance, engine hours, idling, fuel burned and what it cost in naira. It requires no fuel-level sensor and no CAN adapter.',
      featureList: [
        'Live GPS tracking with automatic trip segmentation',
        'Stop detection with real addresses',
        'Idling time measured to the minute and priced in naira',
        'Fuel modelled from distance and idling, priced in naira',
        'Driver receipt upload with OCR and reconciliation against measured burn',
        'Effective-dated fuel pricing so past periods keep their own price',
        'Driving behaviour events and per-driver scoring',
      ],
      offers: {
        '@type': 'AggregateOffer',
        priceCurrency: 'NGN',
        lowPrice: '3500',
        highPrice: '10000',
        offerCount: 3,
        unitText: 'per vehicle per month',
        url: `${SITE}/pricing`,
      },
    },
    {
      '@type': 'FAQPage',
      '@id': `${SITE}/#faq`,
      mainEntity: [
        {
          '@type': 'Question',
          name: 'Does FuelSense need a fuel-level sensor in the tank?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'No. Fuel is modelled from what the tracker measures well: odometer-validated distance against the vehicle’s rated economy, plus engine-on idling at an idle burn rate. Nothing is fitted to the tank or spliced into the fuel line, and every litre shown as money is labelled as modelled.',
          },
        },
        {
          '@type': 'Question',
          name: 'How accurate is GPS-derived fuel measurement?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'It is a model, not a measurement, and FuelSense says so wherever litres appear as money. Accuracy depends on the vehicle’s rated economy and on clean tracker data, so every trip carries a confidence score with its reasons. Receipts are the only fuel figures treated as fact, and they are shown beside the model rather than mixed into it.',
          },
        },
        {
          '@type': 'Question',
          name: 'Can FuelSense detect fuel theft or siphoning?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Not directly. Without a fuel-level sensor or CAN bus connection there is no way to observe fuel leaving a tank. FuelSense instead compares litres purchased on receipts against burn measured from the vehicle’s movement, and raises any gap as a discrepancy for a manager to investigate rather than as an accusation.',
          },
        },
        {
          '@type': 'Question',
          name: 'What does FuelSense cost?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Pricing is per vehicle per month across three tiers: Essential Sense from ₦3,500 for tracking and trip logs, Active Control from ₦7,500 adding fuel and idling intelligence, and Enterprise Scale priced by volume for large fleets. A one-time activation fee covers configuring each tracker, and paying annually covers twelve months for the price of ten.',
          },
        },
      ],
    },
  ],
};

export function StructuredData() {
  return (
    <script
      type="application/ld+json"
      // Static, developer-authored JSON with no user input in it.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(GRAPH) }}
    />
  );
}
