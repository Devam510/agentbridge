# AgentBridge Production Security: Code Signing Guide

To ensure a seamless, zero-friction experience for normal users, the `install.bat` and `install.sh` scripts (or compiled binaries) must be code-signed. Code signing proves the publisher's identity and prevents OS security warnings like Windows SmartScreen ("Unknown Publisher") or macOS Gatekeeper blocks.

## 1. Windows Authenticode (EV Certificate)

Windows Defender SmartScreen heavily penalizes newly released software. Standard OV (Organization Validation) certificates take months to build "reputation," meaning your users will still see warnings initially. An **EV (Extended Validation) Code Signing Certificate** bypasses the reputation system completely, giving instant trust.

### Steps to Acquire and Sign:
1. **Purchase an EV Code Signing Certificate**:
   - Providers: DigiCert, Sectigo, GlobalSign, SSL.com.
   - Cost: ~$300-$500 / year.
   - Requirement: You must verify your corporate identity (LLC/Inc.) via government records and a verifiable telephone number.
   - Delivery: The private key is delivered on a physical USB token (YubiKey) or a cloud HSM (Hardware Security Module) to comply with new CA/B Forum rules.

2. **Sign the Installer**:
   If you convert `install.bat` to a small executable (`install.exe`) or use a cloud HSM for the `.bat`/`.ps1`:
   ```cmd
   signtool sign /tr http://timestamp.digicert.com /td sha256 /fd sha256 /a "C:\path\to\install.exe"
   ```

3. **User Experience**:
   When users download and run the installer, they will see a blue/white UAC prompt saying "Verified Publisher: Your Company LLC" instead of the red/yellow "Unknown Publisher" block.

## 2. macOS Notarization

Apple requires all software downloaded from outside the Mac App Store to be code-signed with an Apple Developer ID and "notarized" (checked by Apple servers for malware).

### Steps to Acquire and Sign:
1. **Enroll in the Apple Developer Program**:
   - Cost: $99 / year.
   - Requirement: Verify your corporate identity (D-U-N-S number).

2. **Generate Developer ID Certificate**:
   Create a "Developer ID Application" certificate in the Apple Developer Portal and download it to your Keychain.

3. **Wrap and Sign the Script**:
   Raw `.sh` scripts cannot be easily double-clicked. Wrap `install.sh` in an AppleScript app (`.app`) or a `.pkg` installer.
   ```bash
   # Sign the app
   codesign --force --options runtime --sign "Developer ID Application: Your Company LLC (TEAMID)" /path/to/AgentBridgeInstaller.app
   ```

4. **Notarize the App**:
   Zip the `.app` and send it to Apple's notary service.
   ```bash
   # Submit for notarization
   xcrun notarytool submit AgentBridgeInstaller.zip --apple-id "your@email.com" --password "app-specific-password" --team-id "TEAMID" --wait

   # Staple the ticket to the app so it works offline
   xcrun stapler staple AgentBridgeInstaller.app
   ```

5. **User Experience**:
   Users download the `.dmg` or `.zip`. Double-clicking the `.app` will open normally without the "App cannot be opened because the developer cannot be verified" error.

## 3. Local Server CORS Restriction
To prevent malicious websites from making requests to `http://localhost:3000` to silently install malicious bridges into Claude Desktop, the Companion server must restrict CORS to the Browser Extension.

In `platform/companion/server.ts`:
```typescript
const ALLOWED_ORIGIN = 'chrome-extension://YOUR_EXTENSION_ID';
app.use(cors({
  origin: function (origin, callback) {
    if (!origin || origin === ALLOWED_ORIGIN) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
}));
```
