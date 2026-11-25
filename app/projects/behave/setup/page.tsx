import Link from "next/link";

// One-off setup for the two automatic feeds. No secrets on this page: the token lives
// in Vercel (BEHAVE_INGEST_TOKEN), the Shortcut and the Mac's LaunchAgent only.
const URL = "https://your-site.com/projects/behave/api/ingest";

const PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.jordialbanell.behave-sync</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/env</string>
    <string>node</string>
    <string>/Users/YOU/behave/behave-activitywatch-sync.mjs</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>BEHAVE_INGEST_TOKEN</key><string>PASTE-THE-TOKEN</string>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>StartInterval</key><integer>1800</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>/tmp/behave-sync.log</string>
  <key>StandardErrorPath</key><string>/tmp/behave-sync.log</string>
</dict>
</plist>`;

export default function BehaveSetup() {
  return (
    <main className="bh-main">
      <article className="bh-doc">
        <p><Link href="/projects/behave">&#8592; Back to Behave</Link></p>
        <h1 className="bh-h1">Setting up the feeds</h1>
        <p>
          Two things send numbers on their own: an iPhone Shortcut for Apple Watch data, and a small script on the Mac for
          laptop time. Both use the same secret token. Meals and phone screen time are logged in the app itself.
        </p>

        <h2>1. The token</h2>
        <ol>
          <li>In Terminal, run <code>openssl rand -hex 32</code> and copy the result.</li>
          <li>In Vercel, project jordialbanell, add an environment variable <code>BEHAVE_INGEST_TOKEN</code> with that value, for Production and Preview, then redeploy.</li>
          <li>Keep it somewhere safe (a password manager). Anyone with it can write numbers into Behave, but can&apos;t read anything.</li>
        </ol>

        <h2>2. Apple Watch: two Shortcut automations</h2>
        <p>
          In the Shortcuts app: Automation, New Automation, Time of Day, set the time, choose Run Immediately, then add the actions below.
          The exact action names can differ slightly between iOS versions; the shape is what matters.
        </p>
        <p><strong>Morning, 9:00: last night&apos;s sleep</strong></p>
        <ol>
          <li>Find Health Samples where Type is Sleep, Value is Asleep (include the stages if listed), Start Date is in the last 18 hours.</li>
          <li>Get Details of Health Samples: Duration.</li>
          <li>Calculate Statistics: Sum, on the durations. Make sure the result is in hours (Convert to hours if offered).</li>
          <li>Get Contents of URL: <code>{URL}</code>, Method POST, Headers <code>Authorization</code> = <code>Bearer YOUR-TOKEN</code>, Request Body JSON with <code>source</code> = <code>watch</code> and <code>sleep_hours</code> = the Statistics result.</li>
        </ol>
        <p><strong>Night, 23:45: today&apos;s movement</strong></p>
        <ol>
          <li>Find Health Samples where Type is Exercise Minutes (Apple Exercise Time), Start Date is today. Calculate Statistics: Sum.</li>
          <li>Find Health Samples where Type is Steps, Start Date is today. Calculate Statistics: Sum.</li>
          <li>Get Contents of URL as above, Request Body JSON with <code>source</code> = <code>watch</code>, <code>exercise_minutes</code> and <code>steps</code>.</li>
        </ol>
        <p className="bh-muted">
          Run each one by hand once: the reply should say <code>&quot;ok&quot;: true</code> and show what was saved. If iOS asks
          to allow sharing Health data with Shortcuts, allow it.
        </p>

        <h2>3. Laptop: ActivityWatch</h2>
        <ol>
          <li>Install ActivityWatch from activitywatch.net and let it run (it lives in the menu bar and stays on your Mac).</li>
          <li>Copy <code>scripts/behave-activitywatch-sync.mjs</code> from the repo to <code>~/behave/</code>.</li>
          <li>Test it: <code>DRY_RUN=1 node ~/behave/behave-activitywatch-sync.mjs</code> should print today&apos;s and yesterday&apos;s minutes.</li>
          <li>
            Save this as <code>~/Library/LaunchAgents/com.jordialbanell.behave-sync.plist</code>, with your username and the token filled in,
            then run <code>launchctl load ~/Library/LaunchAgents/com.jordialbanell.behave-sync.plist</code>. It sends every 30 minutes; the log is in <code>/tmp/behave-sync.log</code>.
          </li>
        </ol>
        <pre>{PLIST}</pre>
        <p className="bh-muted">
          Laptop time is when ActivityWatch sees keyboard or mouse activity. The late part counts 11pm to 4am.
        </p>
      </article>
    </main>
  );
}
