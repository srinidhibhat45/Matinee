import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, Text, TextField } from '../m3';
import { cloudSync } from '../../services/cloudSync';
import { performFullSync } from '../../services/database';
import { useTheme } from '../../context/ThemeContext';
import { useNotice } from '../../context/NoticeContext';
export default function AccountSync() {
  const {
    colors
  } = useTheme();
  const notice = useNotice();
  const [status, setStatus] = useState<Awaited<ReturnType<typeof cloudSync.getSyncStatus>> | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => cloudSync.getSyncStatus().then(setStatus).catch(() => {});
  useEffect(() => {
    refresh();
  }, []);
  async function connect(create: boolean) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await cloudSync.connectAccount(email, password, create);
      setPassword('');
      setShowForm(false);
      await performFullSync();
      notice({
        message: 'Account connected and library synced'
      });
    } catch (e: any) {
      const code = String(e.code ?? '');
      setError(code.includes('operation-not-allowed') ? 'Account sign-in is not enabled on this Firebase project yet. Your local library is safe.' : code.includes('invalid-credential') || code.includes('wrong-password') ? 'Email or password was not recognised.' : code.includes('email-already-in-use') ? 'An account already exists for this email. Choose Sign in.' : e.message || 'Could not connect. Please try again.');
    } finally {
      setBusy(false);
      await refresh();
    }
  }
  return <View style={{
    gap: 12
  }}>
    <Text variant="bodyMedium" color={colors.onSurfaceVariant}>{status?.authenticated ? `Signed in as ${status.email}` : 'Your library works without an account. Connect an account to sync independently of your API keys.'}</Text>
    <Text variant="bodySmall" color={colors.onSurfaceVariant} accessibilityLiveRegion="polite">{status?.pending ?? 0} changes waiting to sync{status?.lastSync ? ` · Last synced ${new Date(status.lastSync).toLocaleString()}` : ''}</Text>
    {(error || status?.error) && <Text variant="bodyMedium" color={colors.error} accessibilityRole="alert">{error ?? status?.error}</Text>}
    {status?.authenticated ? <View style={{
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8
    }}>
      <Button label="Sync now" loading={busy} disabled={busy} variant="tonal" onPress={async () => {
        setBusy(true);
        try {
          await performFullSync();
          notice({
            message: 'Library synced'
          });
        } catch (e: any) {
          setError(e.message);
        } finally {
          setBusy(false);
          refresh();
        }
      }} />
      <Button label="Sign out" variant="text" disabled={busy} onPress={() => {
        cloudSync.disconnectAccount().then(() => {
          refresh();
          notice({
            message: 'Signed out; your local library is kept'
          });
        }).catch(() => setError('Could not sign out.'));
      }} />
    </View> : <Button label={showForm ? 'Close account form' : 'Connect an account'} variant="outlined" onPress={() => setShowForm(!showForm)} />}
    {!status?.authenticated && cloudSync.isCloudEnabled() && <Button label="Sync saved connection" variant="tonal" loading={busy} disabled={busy} onPress={async () => {
      setBusy(true);
      try {
        await performFullSync();
        notice({
          message: 'Library synced'
        });
      } catch (e: any) {
        setError(e.message);
      } finally {
        setBusy(false);
        refresh();
      }
    }} />}
    {showForm && <View style={{
      gap: 12
    }}>
      <TextField label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
      <TextField label="Password" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoComplete="password" />
      <View style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8
      }}><Button label="Sign in" loading={busy} disabled={busy} onPress={() => connect(false)} /><Button label="Create account" variant="outlined" disabled={busy} onPress={() => connect(true)} /></View>
    </View>}
  </View>;
}
