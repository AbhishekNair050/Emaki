import { describe, expect, it } from 'vitest';
import { withAndroidOrientation, withIosOrientation } from '../src/export.ts';

// As Capacitor generates them (android/app/src/main/AndroidManifest.xml, ios/App/App/Info.plist), shortened.
const MANIFEST = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application android:label="@string/app_name">
        <activity
            android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode|navigation|density"
            android:name=".MainActivity"
            android:label="@string/title_activity_main"
            android:launchMode="singleTask"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
            </intent-filter>
        </activity>
        <activity-alias android:name=".Alias" android:targetActivity=".MainActivity" />
    </application>
</manifest>
`;

const PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDisplayName</key>
	<string>Gullwing</string>
	<key>UISupportedInterfaceOrientations</key>
	<array>
		<string>UIInterfaceOrientationPortrait</string>
		<string>UIInterfaceOrientationLandscapeLeft</string>
		<string>UIInterfaceOrientationLandscapeRight</string>
	</array>
	<key>UISupportedInterfaceOrientations~ipad</key>
	<array>
		<string>UIInterfaceOrientationPortrait</string>
		<string>UIInterfaceOrientationPortraitUpsideDown</string>
		<string>UIInterfaceOrientationLandscapeLeft</string>
		<string>UIInterfaceOrientationLandscapeRight</string>
	</array>
</dict>
</plist>
`;

/** The strings listed under a key of the plist. */
function listed(plist: string, key: string): string[] {
  const m = new RegExp(`<key>${key}</key>\\s*<array>([\\s\\S]*?)</array>`).exec(plist);
  return m ? [...m[1]!.matchAll(/<string>([^<]*)<\/string>/g)].map((x) => x[1]!) : [];
}

describe('phone orientation, Android', () => {
  it('turns the main activity only between the two landscapes, or the two portraits', () => {
    const landscape = withAndroidOrientation(MANIFEST, 'landscape')!;
    expect(landscape).toContain('<activity android:screenOrientation="sensorLandscape"');
    expect(landscape.match(/screenOrientation/g)).toHaveLength(1);
    expect(landscape).toContain('android:name=".MainActivity"');
    expect(landscape).toContain('<activity-alias android:name=".Alias"');
    const portrait = withAndroidOrientation(landscape, 'portrait')!;
    expect(portrait).toContain('android:screenOrientation="sensorPortrait"');
    expect(portrait.match(/screenOrientation/g)).toHaveLength(1);
  });

  it('lets it turn freely for any, and changes nothing else', () => {
    expect(withAndroidOrientation(withAndroidOrientation(MANIFEST, 'landscape')!, 'any')).toBe(MANIFEST);
    expect(withAndroidOrientation(MANIFEST, 'any')).toBe(MANIFEST);
  });

  it('says so when there is no main activity', () => {
    expect(withAndroidOrientation('<manifest><application/></manifest>', 'landscape')).toBeNull();
  });
});

describe('phone orientation, iOS', () => {
  it('lists only the landscapes, and asks iPads for the whole screen', () => {
    const plist = withIosOrientation(PLIST, 'landscape');
    const both = ['UIInterfaceOrientationLandscapeLeft', 'UIInterfaceOrientationLandscapeRight'];
    expect(listed(plist, 'UISupportedInterfaceOrientations')).toEqual(both);
    expect(listed(plist, 'UISupportedInterfaceOrientations~ipad')).toEqual(both);
    expect(plist).toMatch(/<key>UIRequiresFullScreen<\/key>\s*<true\/>\s*<\/dict>\s*<\/plist>\s*$/);
    expect(plist).toContain('<string>Gullwing</string>');
    // Again: the same file, no second copy of any key.
    expect(withIosOrientation(plist, 'landscape')).toBe(plist);
  });

  it('lists the portraits, or every way for any', () => {
    const portrait = withIosOrientation(PLIST, 'portrait');
    expect(listed(portrait, 'UISupportedInterfaceOrientations')).toEqual(['UIInterfaceOrientationPortrait']);
    expect(listed(portrait, 'UISupportedInterfaceOrientations~ipad')).toEqual(['UIInterfaceOrientationPortrait', 'UIInterfaceOrientationPortraitUpsideDown']);
    const any = withIosOrientation(portrait, 'any');
    expect(listed(any, 'UISupportedInterfaceOrientations')).toHaveLength(3);
    expect(listed(any, 'UISupportedInterfaceOrientations~ipad')).toHaveLength(4);
  });

  it('adds the lists to a plist that has none', () => {
    const bare = '<?xml version="1.0"?>\n<plist version="1.0">\n<dict>\n\t<key>CFBundleName</key>\n\t<string>B</string>\n</dict>\n</plist>\n';
    const plist = withIosOrientation(bare, 'landscape');
    expect(listed(plist, 'UISupportedInterfaceOrientations')).toHaveLength(2);
    expect(plist.endsWith('</dict>\n</plist>\n')).toBe(true);
  });
});

describe('the Java the Android build needs', () => {
  it('reads the major version from java -version', async () => {
    const { javaMajor, JAVA_NEEDED } = await import('../src/export.ts');
    expect(javaMajor('java version "17.0.11" 2024-04-16 LTS')).toBe(17);
    expect(javaMajor('openjdk version "21.0.5" 2024-10-15 LTS')).toBe(21);
    expect(javaMajor('openjdk version "21" 2023-09-19')).toBe(21);
    expect(javaMajor('java version "1.8.0_402"')).toBe(8);
    expect(javaMajor('no java here')).toBeNull();
    expect(JAVA_NEEDED).toBe(21);
  });
});
