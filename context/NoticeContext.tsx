import React, { createContext, useCallback, useContext, useState } from 'react';
import { Snackbar } from '../components/m3';
interface Notice {
  message: string;
  undo?: () => Promise<void>;
  actionLabel?: string;
}
const Context = createContext<(notice: Notice) => void>(() => {});
export const useNotice = () => useContext(Context);
export function NoticeProvider({
  children
}: {
  children: React.ReactNode;
}) {
  const [notice, setNotice] = useState<Notice | null>(null);
  const dismiss = useCallback(() => setNotice(null), []);
  return <Context.Provider value={setNotice}>{children}<Snackbar visible={!!notice} message={notice?.message ?? ''} duration={notice?.undo ? 10000 : 5000} bottomOffset={160} onDismiss={dismiss} actionLabel={notice?.undo ? notice.actionLabel ?? 'Undo' : undefined} onAction={() => {
      const fn = notice?.undo;
      if (fn) fn().catch(() => setNotice({
        message: 'Could not restore the change. Please try again.'
      }));
    }} /></Context.Provider>;
}
