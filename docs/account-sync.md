# Account sync rollout

The local app works without sign-in. Native API credentials migrate to SecureStore, and Gemini credentials and key bindings are no longer uploaded or included in backups. Web credentials remain in browser storage; use a trusted device.

The existing API-key namespace remains available until the user connects an account. Connecting uses Firebase email/password authentication and stores future records under the authenticated UID. Native auth persists through AsyncStorage via Firebase's React Native persistence adapter; passwords are not stored by the app.

Deployment requires enabling Email/Password in the Firebase project's Authentication providers and deploying `firestore.rules`. These are remote configuration steps; the code change does not perform them.

For an existing installation:

1. Export a backup before changing server rules.
2. Enable email/password authentication.
3. Create/sign into the account in Library → Settings → Cloud sync; sync the existing local library. If the new rules are already active, import the backup into the signed-in app and sync.
4. Verify library counts on a second device using the same account.
5. Deploy the UID-based rules and retire legacy API-key namespaces. Existing legacy raw key-binding documents should be removed from Firestore by the project owner. Revoking previously shared credentials may be appropriate depending on the old server rules.

The rules intentionally deny unauthenticated API-key namespaces. Older app versions must update or export a backup before this cutover. Never restore permissive rules to retain legacy compatibility.

Sync writes are queued durably and retried on foreground and every two minutes while active. Deletions use tombstones. A cloud failure is shown as pending local changes, not successful sync. Date conflicts use UTC-normalized update timestamps, and IDs include media type. Cloud availability and authentication require device-level validation against the deployed project.
