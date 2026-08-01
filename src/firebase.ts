import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);

/**
 * Firestore の永続キャッシュ（実装仕様書 F2-a）。
 *
 * 旧実装は getFirestore() + enableIndexedDbPersistence() だった。この API は
 * 非推奨で、かつ複数タブを開いていると failed-precondition で無言で失敗する。
 * その状態ではキャッシュが効かず、リロードのたびに全単語が課金対象の読み取りに
 * なっていた。
 *
 * persistentMultipleTabManager を使うと複数タブでも共有され、onSnapshot が
 * resume token を使えるため、リロード後の読み取りが差分だけで済む。
 *
 * 注意: この設定は初回の Firestore アクセスより前に一度だけ実行する必要がある。
 * そのため getFirestore() ではなく initializeFirestore() をここで呼び切っている。
 */
export const db = initializeFirestore(
  app,
  {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  },
  firebaseConfig.firestoreDatabaseId
);

export const auth = getAuth(app);
