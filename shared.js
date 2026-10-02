/* =====================================================================
   LiveCore AI — shared.js
   Các hàm/dữ liệu dùng chung cho cả 3 trang: login.html, register.html, app.html.
   File này KHÔNG đụng tới DOM riêng của từng trang (ngoại trừ authMode()/wireSbBox(),
   vốn đã tự kiểm tra phần tử có tồn tại hay không trước khi dùng).
   ===================================================================== */

/* ===== helpers ===== */
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const vnd=n=>Number(n||0).toLocaleString('vi-VN')+'đ';
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const shuffle=a=>{a=a.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a};
const isoDay=off=>{const d=new Date();d.setDate(d.getDate()+off);return d.toISOString().slice(0,10)};
const dmy=iso=>iso?iso.split('-').reverse().join('/'):'';
const today=()=>isoDay(0);
const nowT=()=>new Date().toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
let UID=null;
const uk=k=>UID?k+'_'+UID:null;
var syncHook=null;
const store={get(k){const kk=uk(k);if(!kk)return null;try{return JSON.parse(localStorage.getItem(kk))}catch(e){return null}},set(k,v){const kk=uk(k);if(!kk)return;const j=JSON.stringify(v);try{const old=localStorage.getItem(kk);localStorage.setItem(kk,j);if(syncHook&&old!==j)syncHook(k)}catch(e){return false}return true}};
const raw={get(k,area){try{return JSON.parse((area==='session'?sessionStorage:localStorage).getItem(k))}catch(e){return null}},set(k,v,area){try{(area==='session'?sessionStorage:localStorage).setItem(k,JSON.stringify(v))}catch(e){}},del(k){try{localStorage.removeItem(k);sessionStorage.removeItem(k)}catch(e){}}};

/* ===== Tài khoản: gói dịch vụ, mật khẩu, người dùng (bản demo: lưu trong trình duyệt) ===== */
const YEAR_DISC=0.10; /* giảm khi trả theo năm */
const PLANS={
  basic:{name:'Cơ bản',sub:'Cá nhân',price:249000,products:30,runs:20,personas:6,coach:true,hist:3,reportTier:'basic',badge:'Phổ biến nhất',icon:'user',
    features:['1 tài khoản · 20 giờ giám sát mỗi tháng','30 sản phẩm trong "Hồ sơ Sản phẩm chủ"','Thư viện tài liệu 50 trang mỗi tháng','Live tập sự 20 phiên, 6 dạng khách hàng','Rà soát kịch bản đủ nhóm từ ngữ vi phạm, không giới hạn số lượt','Trợ lý bình luận, cảnh báo phát ngôn theo thời gian thực trong 20 giờ','Bảng nhắc lời, không giới hạn thời lượng','Báo cáo sau Livestream với 4 tiêu chí','Đề xuất cải thiện ở mức rút gọn','Lưu lịch sử 3 tháng']},
  pro:{name:'Chuyên nghiệp',sub:'Cá nhân',price:699000,products:200,runs:80,personas:10,coach:true,hist:12,reportTier:'pro',icon:'users',
    features:['1 tài khoản · 80 giờ giám sát mỗi tháng','Toàn bộ gói Cơ bản','200 sản phẩm trong "Hồ sơ Sản phẩm chủ"','Thư viện tài liệu 300 trang mỗi tháng','Live tập sự 80 phiên, đủ 10 dạng khách hàng','Rà soát kịch bản, đối chiếu lịch sử cảnh báo của chính người dùng','Trợ lý bình luận đầy đủ: tự động bám theo bình luận, lọc và xếp ưu tiên, cảnh báo phát ngôn theo thời gian thực trong 80 giờ','Bảng nhắc lời tự bám theo tiến độ phát ngôn','Báo cáo đủ 10 tiêu chí, so sánh giữa các phiên','Đề xuất cải thiện đầy đủ, thêm xu hướng, thẻ gắn và khung giờ','Lưu lịch sử 12 tháng']},
  business:{name:'Doanh nghiệp',sub:'Doanh nghiệp',price:2999000,products:1000,runs:Infinity,personas:10,coach:true,hist:24,reportTier:'business',icon:'crown',
    features:['1 Quản trị viên (miễn phí) + 10 tài khoản được phân quyền','Thêm tài khoản: 299.000đ/tài khoản/tháng, tối đa 10 tài khoản','Toàn bộ gói Chuyên nghiệp','Tài khoản tổ chức với 3 cấp phân quyền (Quản trị viên, Quản lý, Streamer)','1000 sản phẩm dùng chung toàn tổ chức','Thư viện tài liệu 2.000 trang mỗi tháng','80 giờ giám sát thời gian thực cho mỗi tài khoản/tháng','Phân bổ sản phẩm và tài liệu theo phạm vi quyền','Báo cáo tổng hợp theo đội ngũ, theo dõi kết quả luyện tập từng streamer','Lưu lịch sử 24 tháng']}
};
const PLAN_ORDER=['basic','pro','business'];
const fmtN=n=>Math.round(n).toLocaleString('vi-VN');
const capTxt=n=>n===Infinity?'∞':n;
let ME=null;
const users=()=>raw.get('lc_users')||[];
const saveUsers=u=>raw.set('lc_users',u);
const b64=buf=>btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const newSalt=()=>b64(crypto.getRandomValues(new Uint8Array(16)));
async function hashPw(pw,saltB64){
  if(window.crypto&&crypto.subtle){
    const k=await crypto.subtle.importKey('raw',new TextEncoder().encode(pw),'PBKDF2',false,['deriveBits']);
    return 'p1:'+b64(await crypto.subtle.deriveBits({name:'PBKDF2',salt:unb64(saltB64),iterations:150000,hash:'SHA-256'},k,256));
  }
  /* dự phòng yếu hơn khi trình duyệt không có SubtleCrypto (trang không an toàn) */
  let h1=0xdeadbeef,h2=0x41c6ce57;const str=saltB64+pw;
  for(let i=0;i<str.length;i++){const c=str.charCodeAt(i);h1=Math.imul(h1^c,2654435761);h2=Math.imul(h2^c,1597334677)}
  h1=Math.imul(h1^(h1>>>16),2246822507)^Math.imul(h2^(h2>>>13),3266489909);
  h2=Math.imul(h2^(h2>>>16),2246822507)^Math.imul(h1^(h1>>>13),3266489909);
  return 'w1:'+(4294967296*(2097151&h2)+(h1>>>0)).toString(36);
}
const safeEq=(a,b)=>{if(a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0};
const validEmail=e=>/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
const validPw=p=>p.length>=8&&/\p{L}/u.test(p)&&/\d/.test(p);
const PW_MSG='Mật khẩu cần ít nhất 8 ký tự, gồm cả chữ và số.';
const initials=n=>n.trim().split(/\s+/).slice(-2).map(w=>w[0]).join('').toUpperCase()||'?';

/* Đếm số lần đăng nhập sai và thời điểm tạm khóa được LƯU VÀO localStorage (thay vì biến JS thường),
   để không bị vô hiệu chỉ bằng cách tải lại trang. */
const loginGuard=()=>{try{const g=raw.get('lc_loginfails');return g&&typeof g.fails==='number'?g:{fails:0,lockUntil:0}}catch(e){return{fails:0,lockUntil:0}}};
const setLoginGuard=g=>raw.set('lc_loginfails',g);

/* tài khoản thử nhanh */
async function ensureDemoUser(){
  const ex=users().find(u=>u.email==='demo@livecore.vn');
  if(ex){if(!raw.get('lc_demo_v2')){ex.plan='business';saveUsers(users().map(u=>u.id===ex.id?ex:u));raw.set('lc_demo_v2',1)}return}
  raw.set('lc_demo_v2',1);
  const salt=newSalt();
  saveUsers([...users(),{id:'udemo',name:'Tài khoản Demo',email:'demo@livecore.vn',plan:'business',salt,hash:await hashPw('Demo@12345',salt),created:Date.now()}]);
}

/* ===== Đám mây (Supabase): các hàm nền tảng dùng chung cho đăng nhập/đăng ký và đồng bộ dữ liệu =====
   Chỉ dùng khóa anon/publishable (công khai). An toàn dữ liệu do Row Level Security ở phía Supabase (xem supabase-setup.sql). */
const SB_DEFAULT={url:'',key:''}; /* Dán Project URL và khóa anon vào đây để mọi người dùng bản này tự động kết nối đám mây */
const sbCfg=()=>{
  const c=raw.get('lc_sbcfg')||{};
  const url=String(SB_DEFAULT.url||c.url||'').trim().replace(/\/+$/,''),key=String(SB_DEFAULT.key||c.key||'').trim();
  return /^(https:\/\/[a-z0-9.-]+|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/i.test(url)&&key.length>=20?{url,key,fixed:!!(SB_DEFAULT.url&&SB_DEFAULT.key)}:null;
};
let sbSess=null;
function keyIsSecret(k){
  if(/^sb_secret_/i.test(k))return true;
  try{const p=JSON.parse(atob(k.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));return p&&p.role==='service_role'}catch(e){return false}
}
async function sbFetch(path,o={}){
  const c=sbCfg();if(!c)throw{code:'nocfg'};
  const h={apikey:c.key,'Content-Type':'application/json',...(o.prefer?{Prefer:o.prefer}:{})};
  if(o.token)h.Authorization='Bearer '+o.token;else if(!/^sb_/i.test(c.key))h.Authorization='Bearer '+c.key;
  let r,t;
  try{r=await fetch(c.url+path,{method:o.method||'GET',headers:h,body:o.body===undefined?undefined:JSON.stringify(o.body)});t=await r.text()}catch(e){throw{code:'network'}}
  let j=null;try{j=t?JSON.parse(t):null}catch(e){}
  if(!r.ok)throw{code:'http',status:r.status,msg:(j&&(j.msg||j.error_description||j.message||j.error_code||j.error))||('HTTP '+r.status)};
  return j;
}
function sbMsg(e){
  if(!e)return 'Có lỗi không xác định.';
  if(e.code==='network')return 'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.';
  if(e.code==='nocfg')return 'Chưa kết nối máy chủ.';
  if(e.code==='expired')return 'Phiên đăng nhập đã hết hạn, hãy đăng nhập lại.';
  const m=String(e.msg||'').toLowerCase();
  if(e.status===429||/rate limit|too many/.test(m))return 'Gửi quá nhiều yêu cầu, hãy thử lại sau ít phút.';
  if(/invalid login|invalid_credentials/.test(m))return 'Email hoặc mật khẩu chưa đúng.';
  if(/not confirmed/.test(m))return 'Email chưa được xác nhận. Mở thư xác nhận (kể cả thư rác) rồi đăng nhập lại.';
  if(/already registered|already exists|user_already_exists/.test(m))return 'Email này đã có tài khoản. Hãy chuyển sang Đăng nhập.';
  if(/signups? (not allowed|disabled)|signup_disabled/.test(m))return 'Máy chủ đang tắt đăng ký tài khoản mới.';
  if(/password/.test(m)&&/(short|weak|least|characters)/.test(m))return 'Máy chủ từ chối mật khẩu này vì quá yếu hoặc quá ngắn.';
  if(e.status===404)return 'Chưa tạo bảng dữ liệu trên Supabase. Hãy chạy file supabase-setup.sql trong SQL Editor.';
  if(e.status===401||e.status===403)return 'Máy chủ từ chối quyền truy cập. Kiểm tra lại khóa anon và các chính sách RLS.';
  return 'Máy chủ báo lỗi: '+(e.msg||e.status);
}
const sessFrom=r=>({access:r.access_token,refresh:r.refresh_token,exp:Date.now()+(r.expires_in||3600)*1000,user:r.user});
function saveSbSess(){raw.del('lc_sbsess');if(sbSess)raw.set('lc_sbsess',sbSess,sbSess.remember?'local':'session')}
let sbRefreshing=null;
async function sbToken(){
  if(!sbSess)throw{code:'expired'};
  if(sbSess.exp-Date.now()>60000)return sbSess.access;
  if(!sbRefreshing)sbRefreshing=(async()=>{
    try{
      const r=await sbFetch('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:sbSess.refresh}});
      sbSess={...sbSess,...sessFrom(r),user:r.user||sbSess.user};saveSbSess();
    }catch(e){if(e.code==='http'&&e.status>=400&&e.status<500){sbSess=null;throw{code:'expired'}}throw e}
    finally{sbRefreshing=null}
  })();
  await sbRefreshing;return sbSess.access;
}
const sbAuthed=async(path,o={})=>sbFetch(path,{...o,token:await sbToken()});
const sbSignIn=async(email,pw)=>sessFrom(await sbFetch('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password:pw}}));
async function sbSignUp(email,pw,name,plan){const r=await sbFetch('/auth/v1/signup',{method:'POST',body:{email,password:pw,data:{name,plan}}});return r&&r.access_token?sessFrom(r):null}
const isUuid=s=>/^[0-9a-f-]{32,40}$/i.test(String(s||''));
async function sbProfile(sess){
  const id=sess.user.id;if(!isUuid(id))throw{code:'http',status:400,msg:'id không hợp lệ'};
  const rows=await sbAuthed(`/rest/v1/profiles?id=eq.${id}&select=name,plan,created_at`);
  if(rows&&rows[0])return rows[0];
  const meta=sess.user.user_metadata||{},plan=PLANS[meta.plan]?meta.plan:'basic',name=(meta.name||sess.user.email||'').slice(0,60);
  try{await sbAuthed('/rest/v1/profiles',{method:'POST',prefer:'resolution=merge-duplicates,return=minimal',body:{id,name,plan}})}catch(e){}
  return{name,plan,created_at:new Date().toISOString()};
}

/* ===== Cấu hình kết nối máy chủ (hộp "Kết nối máy chủ (Supabase)" — dùng chung ở login.html và register.html) =====
   Mọi phần tử đều được kiểm tra tồn tại trước khi dùng, nên gọi an toàn ở cả hai trang. */
function authMode(){
  const c=sbCfg(),s=$('#sbState');
  if(s){s.className='tag '+(c?'ok':'');s.textContent=c?'Đám mây (Supabase)':'Lưu trên máy này'}
  const f=$('#sbForm'),fx=$('#sbFixed');
  if(f)f.hidden=!!(c&&c.fixed);if(fx)fx.hidden=!(c&&c.fixed);
  if(c&&!c.fixed&&$('#sb-url')&&!$('#sb-url').value){$('#sb-url').value=c.url;$('#sb-key').value=c.key}
  const lab=$('#rg-terms-l');
  if(lab)lab.textContent=c?'Mình hiểu đây là bản demo của đồ án: tài khoản và dữ liệu được lưu trên máy chủ Supabase của nhóm, không dùng mật khẩu thật của các dịch vụ khác.':'Mình hiểu đây là bản demo: tài khoản chỉ lưu trong trình duyệt này, không dùng mật khẩu thật của các dịch vụ khác.';
  const hint=$('#cloudHint');if(hint)hint.hidden=!c;
}
function wireSbBox(){
  if($('#sb-save'))$('#sb-save').onclick=async()=>{
    const url=$('#sb-url').value.trim().replace(/\/+$/,''),key=$('#sb-key').value.trim(),m=$('#sb-msg'),say=(t,c)=>{m.className='small '+(c||'muted');m.textContent=t};
    if(!/^(https:\/\/[a-z0-9.-]+|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/i.test(url))return say('Địa chỉ cần có dạng https://xxxx.supabase.co','bad');
    if(key.length<20)return say('Khóa anon/publishable chưa đúng, hãy dán lại từ trang Project Settings → API.','bad');
    if(keyIsSecret(key))return say('Đây là khóa BÍ MẬT (service_role/secret). Tuyệt đối không dán vào web. Hãy dùng khóa anon public hoặc publishable.','bad');
    raw.set('lc_sbcfg',{url,key});say('Đang kiểm tra kết nối…');
    try{
      const st=await sbFetch('/auth/v1/settings');
      let tbl='';try{await sbFetch('/rest/v1/user_data?select=user_id&limit=1')}catch(e){if(e.status===404)tbl=' Nhưng chưa thấy bảng dữ liệu: hãy chạy file supabase-setup.sql trong SQL Editor.'}
      const conf=st&&st.mailer_autoconfirm===false?' Đăng ký sẽ cần xác nhận qua email.':' Đăng ký không cần xác nhận email.';
      say('Kết nối được.'+conf+tbl,tbl?'warn':'ok');authMode();
    }catch(e){raw.del('lc_sbcfg');authMode();say(e.code==='http'&&(e.status===401||e.status===404)?'Máy chủ không nhận khóa hoặc địa chỉ này. Kiểm tra lại Project URL và khóa.':sbMsg(e),'bad')}
  };
  if($('#sb-clear'))$('#sb-clear').onclick=()=>{raw.del('lc_sbcfg');$('#sb-url').value='';$('#sb-key').value='';$('#sb-msg').textContent='Đã xóa kết nối, quay về lưu trên máy.';authMode()};
}

/* Hiện/ẩn mật khẩu — dùng chung cho mọi nút .pwt trên trang hiện tại */
function wirePwToggles(){
  document.querySelectorAll('.pwt').forEach(b=>b.onclick=()=>{
    const i=$('#'+b.dataset.for),show=i.type==='password';
    i.type=show?'text':'password';b.textContent=show?'Ẩn':'Hiện';
  });
}
