/* Executes the real TypeScript services against SQLite, with offline Firebase/storage adapters. */
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const memory = new Map();
const remote = new Map();
let online = true;
const sqlite = new DatabaseSync(':memory:');
const args = p => p.length === 1 && Array.isArray(p[0]) ? p[0] : p;
const db = {
  execAsync: async s => sqlite.exec(s),
  runAsync: async (s,...p) => {const r=sqlite.prepare(s).run(...args(p));return {lastInsertRowId:Number(r.lastInsertRowid),changes:Number(r.changes)};},
  getFirstAsync: async (s,...p) => sqlite.prepare(s).get(...args(p)) ?? null,
  getAllAsync: async (s,...p) => sqlite.prepare(s).all(...args(p)),
  withTransactionAsync: async fn=>{sqlite.exec('BEGIN');try{await fn();sqlite.exec('COMMIT');}catch(e){sqlite.exec('ROLLBACK');throw e;}},
};
const storage = {getItem:async k=>memory.get(k)??null,setItem:async(k,v)=>{memory.set(k,v);},removeItem:async k=>{memory.delete(k);},getAllKeys:async()=>[...memory.keys()],multiRemove:async ks=>ks.forEach(k=>memory.delete(k))};
const auth = { currentUser:null,authStateReady:async()=>{} };
const cloudDoc = ref => ({exists:()=>remote.has(ref), data:()=>remote.get(ref)});
const mocks = {
 'expo-sqlite':{openDatabaseAsync:async()=>db},
 '@react-native-async-storage/async-storage':{default:storage,...storage},
 'react-native':{Platform:{OS:'web'}},
 'expo-secure-store':{getItemAsync:storage.getItem,setItemAsync:storage.setItem,deleteItemAsync:storage.removeItem},
 'expo-crypto':{CryptoDigestAlgorithm:{SHA256:'sha256'},digestStringAsync:async(_,s)=>crypto.createHash('sha256').update(s).digest('hex')},
 'firebase/auth':{getAuth:()=>auth,initializeAuth:()=>auth,signOut:async()=>{auth.currentUser=null;},signInWithEmailAndPassword:async()=>{auth.currentUser={uid:'account-1',email:'test@example.com'};},createUserWithEmailAndPassword:async()=>{auth.currentUser={uid:'account-1',email:'test@example.com'};}},
 'firebase/firestore':{
   doc:(_db,...segments)=>segments.join('/'),collection:(_db,...segments)=>segments.join('/'),
   getDoc:async ref=>{if(!online)throw Error('Offline');return cloudDoc(ref);},
   getDocs:async prefix=>{if(!online)throw Error('Offline');return {docs:[...remote].filter(([k])=>k.startsWith(prefix+'/')).map(([ref,data])=>({id:ref.split('/').pop(),ref,data:()=>data}))};},
   setDoc:async(ref,data)=>remote.set(ref,data),deleteDoc:async ref=>remote.delete(ref),
   runTransaction:async(_db,fn)=>{if(!online)throw Error('Offline');return fn({get:async ref=>cloudDoc(ref),set:(ref,data)=>remote.set(ref,data)});},
   writeBatch:()=>{const refs=[];return {delete:r=>refs.push(r),commit:async()=>refs.forEach(r=>remote.delete(r))};}
 },
};
const cache = new Map();
function load(file) {
 const absolute=path.resolve(root,file);
 if(cache.has(absolute))return cache.get(absolute).exports;
 if(absolute.endsWith('/services/firebase.ts'))return {getFirebaseApp:()=>({}),getFirestoreDb:()=>({}),isFirebaseConfigured:()=>true};
 const module={exports:{}};cache.set(absolute,module);
 const compiled=ts.transpileModule(readFileSync(absolute,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
 const localRequire=name=>{
   if(mocks[name])return mocks[name];
   if(name.startsWith('.')){const base=path.resolve(path.dirname(absolute),name);return load(existsSync(base+'.ts')?base+'.ts':base);}
   return require(name);
 };
 const fn=vm.runInThisContext(`(function(require,module,exports){${compiled}\n})`,{filename:absolute});fn(localRequire,module,module.exports);return module.exports;
}
let count=0;
async function check(name,fn){await fn();count++;console.log(`✓ ${name}`);}
(async()=>{
 const database=load('services/database.ts'); const activity=load('services/libraryActivity.ts');const {cloudSync}=load('services/cloudSync.ts');const logic=load('services/libraryLogic.ts');
 await database.initDatabase();
 const ratingOf=async(id,type)=>(await database.getRating((await database.getItem(id,type)).id))?.overallRating;
 const make=(id,type='movie',status='watchlist')=>({tmdbId:id,mediaType:type,title:`${type} ${id}`,posterPath:null,backdropPath:null,overview:'',releaseDate:'2020-01-01',genres:'[35]',originalLanguage:'hi',runtime:120,voteAverage:7,status,watchedDate:status==='watched'?'2026-10-01':null});
 const media=(id,type='movie')=>({id,mediaType:type,title:`${type} ${id}`,posterPath:null,backdropPath:null,overview:'',releaseDate:'2020-01-01',genreIds:[35],originalLanguage:'hi',runtime:120,voteAverage:7,voteCount:100,popularity:20});
 await check('Movie and series with the same ID retain separate library records and ratings',async()=>{
  const movie=await database.addItem(make(42,'movie','watched'));const tv=await database.addItem(make(42,'tv','watched'));
  await database.addRating({itemId:movie,overallRating:9});await database.addRating({itemId:tv,overallRating:6});
  assert.equal(await ratingOf(42,'movie'),9);assert.equal(await ratingOf(42,'tv'),6);
 });
 await check('Bookmarking a seen title preserves its rating and seen status',async()=>{
  await activity.toggleBookmark(media(42));assert.equal((await database.getItem(42,'movie')).status,'watched');assert.equal(await ratingOf(42,'movie'),9);
  assert.equal(logic.selectLibrary(await database.getAllItems(),await activity.readActivity(),'watchlist','',null,'recent').length,1);
  await activity.toggleBookmark(media(42));assert.equal((await database.getItem(42,'movie')).status,'watched');
 });
 await check('Removing a bookmark retains episode progress and supports re-bookmarking',async()=>{
  await database.addItem(make(66,'tv'));await activity.markEpisode(media(66,'tv'),1,1,true,42);await activity.toggleBookmark(media(66,'tv'));
  assert.equal((await database.getItem(66,'tv')).status,'interested');assert.equal((await activity.readActivity('episode')).length,1);
  assert.equal(await activity.toggleBookmark(media(66,'tv')),true);
 });
 await check('Episode progress is independent of ratings and does not complete the series',async()=>{
  await activity.markEpisode(media(99,'tv'),1,2,true,45);const item=await database.getItem(99,'tv');assert.equal(item.status,'watchlist');assert.equal((await database.getEpisodeRatings(item.id)).length,0);
 });
 await check('Recommendations respond to hidden titles, genre feedback and preference changes',async()=>{
  const before=await database.getLibraryVersion();await database.setPreference('PREF_LANGUAGES','kn');assert.notEqual(await database.getLibraryVersion(),before);
  await activity.setRecommendationFeedback(media(21),'hide');await activity.setRecommendationFeedback(media(22),'more');
  const result=logic.steerRecommendations([{...media(21),score:99,reason:'A'},{...media(22),score:60,reason:'B'}],await activity.readActivity());assert.deepEqual(result.map(i=>i.id),[22]);
 });
 await check('Library search, type filtering and collection membership distinguish media IDs',async()=>{
  const id=await activity.createCollection('Weekend');await activity.setCollectionMember(id,await database.getItem(42,'tv'),true);
  const result=logic.selectLibrary(await database.getAllItems(),await activity.readActivity(),'watched','TV','tv','title',id);assert.deepEqual(result.map(i=>i.mediaType),['tv']);
 });
 await check('Rewatches create separate diary entries and reject impossible or future dates',async()=>{
  await activity.addViewing(media(42),'2026-01-01','First viewing');await activity.addViewing(media(42),'2026-01-02','Again');assert.equal((await activity.readActivity('diary')).length,2);
  await assert.rejects(()=>activity.addViewing(media(42),'2026-02-31'));await assert.rejects(()=>activity.addViewing(media(42),'2099-01-01'));
 });
 let backup;
 await check('Backup includes activities and stats metadata but excludes credentials',async()=>{
  await database.updateItem((await database.getItem(42,'tv')).id,{totalRuntime:900,episodeCount:10,seasonCount:1,certification:'UA'});
  await database.setPreference('PREF_GEMINI_API_KEY','test-private-key');backup=await database.exportUserData();assert.ok(backup.activity.length);assert.equal(backup.preferences.PREF_GEMINI_API_KEY,undefined);assert.equal(backup.watchedItems.find(i=>i.tmdbId===42&&i.mediaType==='tv').totalRuntime,900);
 });
 await check('Backup restore preserves movie/series collisions, ratings, activity and runtime metadata',async()=>{
  await database.clearAllData();await database.importUserData(backup);assert.equal(await ratingOf(42,'movie'),9);assert.equal(await ratingOf(42,'tv'),6);assert.equal((await database.getItem(42,'tv')).totalRuntime,900);assert.equal((await activity.readActivity('diary')).length,2);
 });
 await check('Malformed restore rolls back instead of partially modifying the library',async()=>{
  const broken=JSON.parse(JSON.stringify(backup));broken.watchedItems[0].title='CHANGED';broken.ratings[0].overallRating=null;await assert.rejects(()=>database.importUserData(broken));assert.notEqual((await database.getAllItems()).find(i=>i.id===broken.watchedItems[0].id)?.title,'CHANGED');
 });
 await check('Version 1 backups without new activities remain supported',async()=>{
  const legacy={...backup};delete legacy.activity;await database.importUserData(legacy);assert.ok(await database.getItem(42,'movie'));
 });
 await check('Undo restores ratings and episode logs after removing a title',async()=>{
  const item=await database.getItem(42,'tv');await database.addEpisodeRating({itemId:item.id,seasonNumber:1,episodeNumber:1,rating:8});const undo=await activity.snapshotItem(item);await database.deleteItem(item.id);await undo();const restored=await database.getItem(42,'tv');assert.equal((await database.getRating(restored.id)).overallRating,6);assert.equal((await database.getEpisodeRatings(restored.id))[0].rating,8);
 });
 await check('Cloud merge updates only the intended media type and preserves newer local ratings',async()=>{
  const tv=await database.getItem(42,'tv');await database.mergeCloudData({watchedItems:{'tv:42':{...tv,title:'Remote series',updatedAt:'2090-01-01T00:00:00Z'}},ratings:{'movie:42':{tmdbId:42,mediaType:'movie',overallRating:1,createdAt:'2000-01-01T00:00:00Z'}},episodeRatings:{},people:{},preferences:{}});
  assert.equal((await database.getItem(42,'tv')).title,'Remote series');assert.equal((await database.getItem(42,'movie')).title,'movie 42');assert.equal(await ratingOf(42,'movie'),9);
 });
 await check('Pending offline writes survive queue persistence and retry with typed IDs',async()=>{
  await cloudSync.initCloudSync('test-key');online=false;await database.addItem(make(123,'movie'));await database.addItem(make(123,'tv'));await assert.rejects(()=>cloudSync.flushQueue());assert.ok((await cloudSync.getSyncStatus()).pending>0);online=true;await cloudSync.flushQueue();const keys=[...remote.keys()];assert.ok(keys.some(k=>k.endsWith('/watched_items/movie:123')));assert.ok(keys.some(k=>k.endsWith('/watched_items/tv:123')));
 });
 await check('Cloud deletion tombstones prevent stale library records being resurrected',async()=>{
  const item=await database.getItem(123,'movie');await database.deleteItem(item.id);await cloudSync.flushQueue();const result=await cloudSync.pullAllData();assert.ok(result.watchedItems['movie:123'].deleted);await database.mergeCloudData(result);assert.equal(await database.getItem(123,'movie'),null);assert.ok(await database.getItem(123,'tv'));
 });
 await check('Re-adding a deleted title does not resurrect its previous cloud rating or episode logs',async()=>{
  const id=await database.addItem(make(555,'tv','watched'));await database.addRating({itemId:id,overallRating:7});await database.addEpisodeRating({itemId:id,seasonNumber:1,episodeNumber:1,rating:8});await cloudSync.flushQueue();
  await database.deleteItem(id);await cloudSync.flushQueue();await database.addItem(make(555,'tv','watchlist'));await cloudSync.flushQueue();await database.performFullSync();
  const restored=await database.getItem(555,'tv');assert.ok(restored);assert.equal(await database.getRating(restored.id),null);assert.equal((await database.getEpisodeRatings(restored.id)).length,0);
 });
 await check('Hidden titles cannot remain visible in bookmarks through independent bookmark records',async()=>{
  const id=await database.addItem(make(777));await activity.toggleBookmark(media(777));await activity.toggleBookmark(media(777));await database.updateItem(id,{status:'not_interested'});
  assert.ok(!logic.selectLibrary(await database.getAllItems(),await activity.readActivity(),'watchlist','',null,'recent').some(i=>i.tmdbId===777));
 });
 await check('Tonight filters enforce language, runtime and subscription constraints',async()=>{
  const {fitsTonight}=load('services/tonight.ts');const item={...media(8),watchProviders:{flatrate:[{provider_id:8}]}};const prefs={mood:'any',maxMinutes:90,language:'hi',subscriptionsOnly:true};
  assert.equal(fitsTonight(item,prefs,[8]),false);assert.equal(fitsTonight({...item,runtime:80},prefs,[8]),true);assert.equal(fitsTonight({...item,runtime:80},prefs,[9]),false);assert.equal(fitsTonight({...item,runtime:80,originalLanguage:'en'},prefs,[8]),false);
 });
 await check('A missed remote deletion also clears stale history already stored on another device',async()=>{
  const item=await database.getItem(555,'tv');await db.runAsync('INSERT INTO ratings (item_id,overall_rating,created_at) VALUES (?,?,?)',[item.id,7,'2000-01-01T00:00:00Z']);await db.runAsync('INSERT INTO episode_ratings (item_id,season_number,episode_number,rating,created_at) VALUES (?,?,?,?,?)',[item.id,1,1,8,'2000-01-01T00:00:00Z']);
  await database.mergeCloudData({watchedItems:{'tv:555':{...item,historyResetAt:'2080-01-01T00:00:00Z',updatedAt:'2090-01-01T00:00:00Z'}},ratings:{},episodeRatings:{},people:{},preferences:{}});
  assert.equal(await database.getRating(item.id),null);assert.equal((await database.getEpisodeRatings(item.id)).length,0);
 });
 await check('Authenticated sync uses account identity independently of the API key',async()=>{
  await cloudSync.connectAccount('test@example.com','password',true);assert.equal(cloudSync.getUserPath(),'account-1');assert.ok((await cloudSync.getSyncStatus()).authenticated);
 });
 console.log(`\n${count} regression checks passed.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
