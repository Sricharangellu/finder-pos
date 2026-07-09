# Hardware setup

## Supported devices

| Device | Notes |
|---|---|
| Barcode scanner | Any USB HID scanner; plug in and scan — no config needed |
| Receipt printer | ESC/POS compatible (thermal). Connect via USB or network IP |
| Cash drawer | RJ11 cable connected to receipt printer (opens on sale completion) |
| Card reader | Stripe Terminal (BBPOS WisePOS E, BBPOS Chipper 2X) |
| Customer display | Second screen on `/display` — shows cart and totals |
| Kitchen display | Tablet or monitor on `/restaurant/kitchen` — shows active orders |

## Card reader setup

1. Go to **Settings → Payments → Card Readers**
2. Click **Register reader**
3. Follow the on-screen pairing instructions (Stripe Terminal SDK)
4. Test with a $0.50 charge before going live

## Receipt printer setup

1. Note the printer's IP address (or USB port)
2. Go to **Settings → Outlets → Receipt Printer**
3. Enter the IP or select the USB port
4. Click **Print test receipt**

## Network requirements

- Minimum: 10 Mbps down / 2 Mbps up per register
- Ascend works fully offline — network is only required for card payments and cloud sync
- Recommended: wired ethernet for the register; Wi-Fi for tablets

## Mobile / tablet

The web app is responsive and works on iPad and Android tablets. For a full-screen kiosk experience:

1. Open the POS URL in Chrome/Safari
2. Use **Add to Home Screen** to install as a PWA
3. Enable Guided Access (iPad) to lock the device to the POS app
