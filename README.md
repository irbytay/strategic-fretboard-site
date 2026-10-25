# Strategic Fretboard Website

A lightweight, responsive promotional website for the Strategic Fretboard Apple and Android apps.

## Pages

- `index.html`: App overview, screenshots, features, and store links
- The home page includes direct Android purchase and verified download access
- `privacy.html`: App and website privacy information

## Direct Android purchase

The direct purchase uses the Stripe Payment Link for price
`price_1Rq8svDbmvIEli9Z5rorCzxC`. Stripe sends signed purchase events to the
`strategic-fretboard-stripe-webhook` Supabase Edge Function. A completed paid
checkout upserts the purchaser into the existing `subscribers` table as
`status: active` and `type: paid`.

The download page uses Supabase passwordless email verification. The
`strategic-fretboard-download` function reads the verified email, confirms an
active `subscribers` record, and returns a ten-minute signed URL for the APK in
the private `strategic-fretboard-downloads` Storage bucket.

### Required Supabase setup

1. Create a private Storage bucket named `strategic-fretboard-downloads`.
2. Upload the signed APK as `Strategic-Fretboard-Android-v2.2.0.apk`.
3. Deploy both functions under `supabase/functions`.
4. Add `STRATEGIC_FRETBOARD_STRIPE_SECRET_KEY` and
   `STRATEGIC_FRETBOARD_STRIPE_WEBHOOK_SECRET` to Edge Function secrets.
5. Add `https://strategicfretboard.com/android-access.html` to the Supabase
   Auth redirect allow list.
6. In Stripe, send `checkout.session.completed` and
   `checkout.session.async_payment_succeeded` to the deployed webhook URL.

Never commit Stripe secret keys, webhook secrets, Supabase secret keys, or the
Android signing keystore.

## Publishing

Upload the public website files to the root of the Strategic Fretboard GitHub
repository. Deploy the `supabase` folder with the Supabase CLI or Dashboard.
The App Store and protected direct Android purchase buttons are active. Google
Play remains marked as coming soon.
