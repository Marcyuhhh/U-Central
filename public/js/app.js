
// ═══════════════════════════════════════════
// DATA
// ═══════════════════════════════════════════

// Faculty registry — starts empty, populated when faculty log in
let facultyRegistry = [];

function getFacultyForOffice(officeId) {
  return facultyRegistry.filter(f => f.officeId === officeId);
}
function upsertCurrentUserInRegistry() {
  if (currentUser.role !== 'faculty' || !currentUser.officeId) return;
  let ex = facultyRegistry.find(f => f.id === currentUser.id);
  if (ex) {
    Object.assign(ex, { name: currentUser.name, email: currentUser.email, bio: currentUser.bio||'', officeId: currentUser.officeId, pic: currentUser.profilePic||currentUser.name.charAt(0).toUpperCase() });
  } else {
    facultyRegistry.push({ id:currentUser.id, name:currentUser.name, email:currentUser.email, officeId:currentUser.officeId, role:'Faculty', bio:currentUser.bio||'', pic:currentUser.profilePic||currentUser.name.charAt(0).toUpperCase() });
  }
}

// Offices — starts empty
let officesData = {};
let nextOfficeId = 1;

let homePosts = [];
let freedomPosts = [];

let orgsData = {}; // id -> { id, name, description, category, privacy, coverColor, members:[], posts:[], creatorId }
let nextOrgId = 1;
const ORG_CATEGORIES = ['Student Organization','Academic Club','Sports','Arts & Culture','Community Service','Tech & Innovation','Other'];
let eventsData = [];
let notificationsData = [
  { id:1, text:"Welcome to U-Central! Explore the campus hub.", time:"Just now", unread:true, postId:null, source:null }
];
let pollsData = [];
let nextPollId = 1;

let currentUser = { id:99, name:"Guest", email:"guest@ucentral.edu", role:"guest", bio:"", password:"guest", officeId:null, profilePic:"G", activityHistory:[] };
let currentMode = 'login';
let homeFilter = 'all', freedomFilter = 'all';
let statsStates = { events:true, notifications:true, polls:true };
let profilePicBase64 = null;
let pendingSharePostId = null, pendingShareSource = null;

// Active users ticker
let activeUsers = Math.floor(Math.random()*180)+20;
document.getElementById('activeUserCount').innerText = activeUsers;
setInterval(() => {
  activeUsers = Math.max(12, Math.min(245, activeUsers + (Math.random()>0.5?1:-1)*Math.floor(Math.random()*5)));
  document.getElementById('activeUserCount').innerText = activeUsers;
}, 9000);

// ═══════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════
// Fetch posts from PostgreSQL
async function loadPostsFromDB() {
    try {
        const response = await fetch('/api/posts');
        const dbPosts = await response.json();
        
        // Format the database rows to match our frontend UI
        const formattedPosts = dbPosts.map(p => ({
            id: p.id,
            author: p.author,
            authorRole: p.author_role.charAt(0).toUpperCase() + p.author_role.slice(1),
            authorPic: p.author.charAt(0).toUpperCase(),
            time: new Date(p.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }),
            content: p.body,
            type: p.post_subtype,
            likes: p.likes || 0,
            liked: false, // We will wire up personal likes later
            comments: [], // We will wire up comments later
            target: p.post_type
        }));

        // Split them into the correct tabs
        homePosts = formattedPosts.filter(p => p.target === 'home');
        freedomPosts = formattedPosts.filter(p => p.target === 'freedom');
        
        // Update the screen
        renderHomePosts();
        renderFreedomPosts();

    } catch (err) {
        console.error("Error loading posts from database:", err);
    }
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function addActivity(action) {
  currentUser.activityHistory.unshift({ action, timestamp:new Date().toLocaleString() });
  if (currentUser.activityHistory.length > 30) currentUser.activityHistory.pop();
  renderHistory();
}
function getTotalCommentCount(comments) {
  if (!comments) return 0;
  return comments.reduce((n,c) => n+1+getTotalCommentCount(c.replies||[]), 0);
}
function showToast(msg) {
  const t = document.getElementById('toast');
  t.innerText = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
}
function isGuest() { return currentUser.role === 'guest'; }
function requireAuth(action) {
  if (isGuest()) {
    document.getElementById('guestPromptModal').classList.remove('hidden');
    return false;
  }
  return true;
}
function closeModal(id) {
  document.getElementById(id)?.classList.add('hidden');
}
// Close modals on overlay click
document.querySelectorAll('.modal-overlay').forEach(m => {
  m.addEventListener('click', e => { if (e.target === m) m.classList.add('hidden'); });
});

// ═══════════════════════════════════════════
// COMMENTS
// ═══════════════════════════════════════════
function renderCommentsTree(comments, postId, source) {
  if (!comments?.length) return '';
  return comments.map(c => `
    <div class="comment-item">
      <strong>${escapeHtml(c.user)}</strong>: ${escapeHtml(c.text)}
      <span style="font-size:0.65rem;color:var(--text-soft);margin-left:0.4rem;">${escapeHtml(c.time)}</span>
      <span style="font-size:0.65rem;color:var(--blue);cursor:pointer;margin-left:0.5rem;" onclick="showReplyInput(${postId},'${source}',${c.id})">↩ Reply</span>
      ${(c.replies||[]).length ? `<div style="margin-left:1rem;margin-top:0.25rem;">${renderCommentsTree(c.replies,postId,source)}</div>` : ''}
    </div>
    <div id="ri-${postId}-${c.id}" style="display:none;" class="reply-area">
      <div style="display:flex;gap:0.4rem;">
        <input type="text" id="rt-${postId}-${c.id}" placeholder="Write a reply…"
          style="flex:1;padding:0.4rem 0.7rem;border-radius:var(--radius-sm);border:1.5px solid var(--border);font-family:inherit;font-size:0.82rem;outline:none;"
          onkeypress="if(event.key==='Enter')addReply(${postId},'${source}',${c.id})">
        <button class="action-btn" onclick="addReply(${postId},'${source}',${c.id})" style="padding:0.3rem 0.6rem;">Send</button>
      </div>
    </div>
  `).join('');
}

// ═══════════════════════════════════════════
// POST CARD
// ═══════════════════════════════════════════
function renderPostCard(post, source) {
  const cc = getTotalCommentCount(post.comments);
  const labels = { announcement:'📢 Announcement', event:'🎉 Event', update:'📝 Update', maintenance:'🔧 Maintenance' };
  const badgeClass = { announcement:'badge-announcement', event:'badge-event', update:'badge-update', maintenance:'badge-maintenance' };
  return `
    <div class="post-card" data-post-id="${post.id}" data-source="${source}">
      <div class="post-header">
        <div class="post-author-info">
          <div class="post-avatar">${escapeHtml((post.authorPic||post.author.charAt(0)).substring(0,2))}</div>
          <div>
            <div style="font-weight:700;font-size:0.88rem;">${escapeHtml(post.author)}</div>
            <div style="font-size:0.7rem;color:var(--text-soft);">${escapeHtml(post.authorRole||'Student')}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;justify-content:flex-end;">
          <span class="post-type-badge ${badgeClass[post.type]||'badge-announcement'}">${labels[post.type]||post.type}</span>
          <span class="post-time">${escapeHtml(post.time)}</span>
        </div>
      </div>
      <div class="post-content">${escapeHtml(post.content)}</div>
      <div class="post-actions">
        <button class="action-btn ${post.liked?'liked':''}" onclick="toggleLike(${post.id},'${source}')">
          <i class="fas fa-heart"></i> ${post.likes}
        </button>
        <button class="action-btn" onclick="toggleComments(${post.id},'${source}')">
          <i class="fas fa-comment"></i> ${cc}
        </button>
        <button class="action-btn" onclick="openShareModal(${post.id},'${source}')">
          <i class="fas fa-share-alt"></i> Share
        </button>
      </div>
      <div class="comment-section" id="cs-${source}-${post.id}" style="display:none;">
        <div id="cl-${source}-${post.id}">${renderCommentsTree(post.comments||[],post.id,source)}</div>
        ${isGuest() ? `<div onclick="requireAuth('comment')" style="display:flex;align-items:center;gap:0.6rem;padding:0.5rem 0.75rem;background:var(--bg);border-radius:var(--radius);cursor:pointer;border:1.5px dashed var(--border);">
          <i class="fas fa-lock" style="color:var(--text-soft);font-size:0.8rem;"></i>
          <span style="font-size:0.83rem;color:var(--text-soft);">Log in to comment</span>
        </div>` : `<div style="display:flex;gap:0.5rem;margin-top:0.75rem;align-items:center;">
          <input type="text" id="ci-${source}-${post.id}" placeholder="Write a comment…"
            style="flex:1;padding:0.5rem 0.75rem;border-radius:var(--radius);border:1.5px solid var(--border);font-family:inherit;font-size:0.85rem;outline:none;"
            onkeypress="if(event.key==='Enter')addComment(${post.id},'${source}',this.value)">
          <button class="action-btn" onclick="addComment(${post.id},'${source}',document.getElementById('ci-${source}-${post.id}').value)">Post</button>
        </div>`}
      </div>
    </div>`;
}

function renderHomePosts() {
  const c = document.getElementById('postsFeed');
  if (!c) return;
  const f = homeFilter==='all' ? homePosts : homePosts.filter(p=>p.type===homeFilter);
  c.innerHTML = f.length ? f.map(p=>renderPostCard(p,'home')).join('') :
    '<div class="empty-state"><i class="fas fa-stream"></i><p>No posts yet</p></div>';
}
function renderFreedomPosts() {
  const c = document.getElementById('freedomPostsContainer');
  if (!c) return;
  const f = freedomFilter==='all' ? freedomPosts : freedomPosts.filter(p=>p.type===freedomFilter);
  c.innerHTML = f.length ? f.map(p=>renderPostCard(p,'freedom')).join('') :
    '<div class="empty-state"><i class="fas fa-chalkboard"></i><p>Nothing here yet — be the first!</p></div>';
}

// ═══════════════════════════════════════════
// POST ACTIONS
// ═══════════════════════════════════════════
window.toggleLike = (id, src) => {
  if (!requireAuth('like')) return;
  const posts = src==='home'?homePosts:freedomPosts;
  const p = posts.find(x=>x.id===id);
  if (!p) return;
  p.liked=!p.liked; p.likes+=p.liked?1:-1;
  addActivity(`${p.liked?'Liked':'Unliked'} a post`);
  src==='home'?renderHomePosts():renderFreedomPosts();
};
window.toggleComments = (id, src) => {
  const el = document.getElementById(`cs-${src}-${id}`);
  if (el) el.style.display = el.style.display==='none'?'block':'none';
};
window.addComment = (id, src, text) => {
  if (!requireAuth('comment')) return;
  if (!text?.trim()) return;
  const posts = src==='home'?homePosts:freedomPosts;
  const p = posts.find(x=>x.id===id);
  if (!p) return;
  if (!p.comments) p.comments=[];
  p.comments.push({ id:Date.now(), user:currentUser.name, text:text.trim(), time:new Date().toLocaleTimeString(), replies:[] });
  addActivity('Commented on a post');
  src==='home'?renderHomePosts():renderFreedomPosts();
};
window.showReplyInput = (postId, src, commentId) => {
  if (!requireAuth('reply')) return;
  const d = document.getElementById(`ri-${postId}-${commentId}`);
  if (d) d.style.display = d.style.display==='none'?'block':'none';
};
window.addReply = (postId, src, commentId) => {
  if (!requireAuth('reply')) return;
  const inp = document.getElementById(`rt-${postId}-${commentId}`);
  const text = inp?.value?.trim();
  if (!text) return;
  const posts = src==='home'?homePosts:freedomPosts;
  const p = posts.find(x=>x.id===postId);
  if (!p) return;
  const findAdd = (arr) => {
    for (let c of arr) {
      if (c.id===commentId) { c.replies=c.replies||[]; c.replies.push({ id:Date.now(), user:currentUser.name, text, time:new Date().toLocaleTimeString(), replies:[] }); return true; }
      if (c.replies && findAdd(c.replies)) return true;
    }
  };
  findAdd(p.comments);
  addActivity('Replied to a comment');
  src==='home'?renderHomePosts():renderFreedomPosts();
};

function navigateToPost(postId, src) {
  showView(src==='home'?'home':'freedom');
  setTimeout(() => {
    const el = document.querySelector(`.post-card[data-post-id="${postId}"][data-source="${src}"]`);
    if (el) { el.scrollIntoView({behavior:'smooth',block:'center'}); el.style.outline='2px solid var(--blue)'; setTimeout(()=>el.style.outline='',2200); }
  }, 150);
}

// ═══════════════════════════════════════════
// SHARE MODAL
// ═══════════════════════════════════════════
window.openShareModal = (postId, src) => {
  if (!requireAuth('share')) return;
  pendingSharePostId = postId; pendingShareSource = src;
  const shareTargets = [
    { icon:'🏠', color:'#dbeafe', label:'My Timeline', sub:'Share to your own feed', target:'home' },
    { icon:'🗣️', color:'#ede9fe', label:'Freedom Wall', sub:'Share to the public community wall', target:'freedom' },
    { icon:'📋', color:'#fef3c7', label:'Copy to Clipboard', sub:'Copy post text to share anywhere', target:'clipboard' },
    { icon:'🔗', color:'#dcfce7', label:'Copy Link', sub:'Share the direct post link', target:'link' }
  ];
  document.getElementById('shareOptions').innerHTML = shareTargets.map(t => `
    <div class="share-option" onclick="executeShare('${t.target}')">
      <div class="share-icon" style="background:${t.color};">${t.icon}</div>
      <div>
        <div class="share-label">${t.label}</div>
        <div class="share-sublabel">${t.sub}</div>
      </div>
    </div>`).join('');
  document.getElementById('shareLinkInput').value = window.location.href + '#post-' + postId;
  document.getElementById('shareModal').classList.remove('hidden');
  addActivity('Opened share menu');
};
window.executeShare = (target) => {
  const posts = pendingShareSource==='home'?homePosts:freedomPosts;
  const post = posts.find(p=>p.id===pendingSharePostId);
  if (!post) return;
  if (target==='home') {
    const exists = homePosts.find(p=>p.id===post.id&&p.sharedFrom);
    if (!exists) {
      homePosts.unshift({ ...post, id:Date.now(), sharedFrom:post.author, time:'Just now', likes:0, liked:false, comments:[] });
    }
    closeModal('shareModal'); showToast('✅ Shared to your timeline!'); renderHomePosts();
  } else if (target==='freedom') {
    freedomPosts.unshift({ ...post, id:Date.now(), sharedFrom:post.author, time:'Just now', likes:0, liked:false, comments:[] });
    closeModal('shareModal'); showToast('✅ Shared to Freedom Wall!'); renderFreedomPosts();
  } else if (target==='clipboard') {
    navigator.clipboard?.writeText(post.content).then(()=>showToast('📋 Copied to clipboard!'));
    closeModal('shareModal');
  } else if (target==='link') {
    copyShareLink();
    closeModal('shareModal');
  }
};
window.copyShareLink = () => {
  const inp = document.getElementById('shareLinkInput');
  inp?.select();
  document.execCommand('copy');
  showToast('🔗 Link copied!');
};

// ═══════════════════════════════════════════
// STATS CARDS
// ═══════════════════════════════════════════
function buildStatsCards() {
  const totalVotes = p => p.options.reduce((s,o)=>s+o.votes,0);
  return `
    <div class="stat-card">
      <div class="stat-header" onclick="toggleStatCard('events')">
        <div class="stat-header-left"><i class="fas fa-calendar-alt"></i><h3>My Events</h3></div>
        <div class="stat-header-right">
          ${!isGuest() ? '<button class="stat-add-btn" onclick="event.stopPropagation();if(!requireAuth(\'add event\'))return;document.getElementById(\'addEventModal\').classList.remove(\'hidden\');setTimeout(()=>document.getElementById(\'newEventName\').focus(),50);" title="Add event">＋</button>' : ''}
          <i class="fas fa-chevron-down chevron ${statsStates.events?'':'rotated'}"></i>
        </div>
      </div>
      <div class="stat-content ${statsStates.events?'':'collapsed'}">
        ${eventsData.length ? eventsData.map((e,i)=>`
          <div class="event-item">
            <div>
              <div style="font-weight:600;color:var(--text);">${escapeHtml(e.name)}</div>
              <div style="font-size:0.72rem;color:var(--text-soft);">${escapeHtml(e.date)}</div>
            </div>
            <button onclick="removeEvent(${i})" style="background:none;border:none;cursor:pointer;color:var(--text-soft);padding:0.2rem 0.4rem;border-radius:0.4rem;font-size:0.78rem;" title="Remove" onmouseover="this.style.color='var(--red)'" onmouseout="this.style.color='var(--text-soft)'">✕</button>
          </div>`).join('')
        : '<div class="empty-state" style="padding:1rem 0;"><p>No events yet — click ＋ to add</p></div>'}
      </div>
    </div>

    <div class="stat-card">
      <div class="stat-header" onclick="toggleStatCard('notifications')">
        <div class="stat-header-left"><i class="fas fa-bell"></i><h3>Notifications</h3></div>
        <i class="fas fa-chevron-down chevron ${statsStates.notifications?'':'rotated'}"></i>
      </div>
      <div class="stat-content ${statsStates.notifications?'':'collapsed'}">
        ${notificationsData.map(n=>`
          <div class="notif-item ${n.unread?'notif-unread':''}"
            onclick="${n.postId?`navigateToPost(${n.postId},'${n.source}')`:`showToast('${escapeHtml(n.text)}')`}">
            <span style="flex:1;">${escapeHtml(n.text)}</span>
            <span style="font-size:0.7rem;color:var(--text-soft);white-space:nowrap;">${escapeHtml(n.time)}</span>
          </div>`).join('')}
      </div>
    </div>

    <div class="stat-card">
      <div class="stat-header" onclick="toggleStatCard('polls')">
        <div class="stat-header-left"><i class="fas fa-chart-bar"></i><h3>Active Polls</h3></div>
        <div class="stat-header-right">
          ${!isGuest() ? '<button class="stat-add-btn" onclick="event.stopPropagation();openAddPollModal();" title="Create poll">＋</button>' : ''}
          <i class="fas fa-chevron-down chevron ${statsStates.polls?'':'rotated'}"></i>
        </div>
      </div>
      <div class="stat-content ${statsStates.polls?'':'collapsed'}">
        ${pollsData.length ? pollsData.map(p=>{
          const total = totalVotes(p);
          if (p.votedOption !== null) {
            return `<div class="poll-voted-view">
              <div style="font-weight:700;font-size:0.8rem;margin-bottom:0.4rem;color:var(--navy);">${escapeHtml(p.question)}</div>
              ${p.options.map((o,i)=>{
                const pct = total>0?Math.round(o.votes/total*100):0;
                const isV = i===p.votedOption;
                return `<div class="vote-bar-wrap">
                  <div class="vote-bar-label">
                    <span style="font-weight:${isV?700:400};color:${isV?'var(--blue)':'var(--text-mid)'};">${isV?'✓ ':''}${escapeHtml(o.text)}</span>
                    <span style="color:var(--text-soft);">${pct}%</span>
                  </div>
                  <div class="vote-bar-track"><div class="vote-bar-fill" style="width:${pct}%;background:${isV?'var(--blue)':'var(--border)'};"></div></div>
                </div>`;
              }).join('')}
              <div style="font-size:0.7rem;color:var(--text-soft);margin-top:0.2rem;">${total} total votes</div>
            </div>`;
          }
          return `<div class="poll-item" onclick="openVotePollModal(${p.id})" style="cursor:pointer;">
            <span style="font-weight:500;">${escapeHtml(p.question)}</span>
            <span style="background:${isGuest()?'var(--bg)':'var(--blue-faint)'};color:${isGuest()?'var(--text-soft)':'var(--blue)'};font-size:0.72rem;padding:0.2rem 0.6rem;border-radius:2rem;font-weight:700;white-space:nowrap;">${isGuest()?'🔒 Login':'Vote'}</span>
          </div>`;
        }).join('')
        : '<div class="empty-state" style="padding:1rem 0;"><p>No polls yet — click ＋ to create one</p></div>'}
      </div>
    </div>`;
}
window.toggleStatCard = type => {
  statsStates[type] = !statsStates[type];
  document.getElementById('statsGrid').innerHTML = buildStatsCards();
};

// ═══════════════════════════════════════════
// EVENTS
// ═══════════════════════════════════════════
window.submitNewEvent = () => {
  if (!requireAuth('add event')) return;
  const name = document.getElementById('newEventName').value.trim();
  const date = document.getElementById('newEventDate').value.trim();
  if (!name) { showToast('⚠️ Enter an event name'); return; }
  if (!date) { showToast('⚠️ Enter the date/time'); return; }
  eventsData.push({ name, date });
  addActivity(`Added event: ${name}`);
  closeModal('addEventModal');
  document.getElementById('statsGrid').innerHTML = buildStatsCards();
  showToast('📅 Event added!');
};
window.removeEvent = i => {
  if (!confirm('Remove this event?')) return;
  const r = eventsData.splice(i,1)[0];
  addActivity(`Removed event: ${r.name}`);
  document.getElementById('statsGrid').innerHTML = buildStatsCards();
};

// ═══════════════════════════════════════════
// POLLS
// ═══════════════════════════════════════════
let pollOptionCount = 2;
function openAddPollModal() {
  if (!requireAuth('create poll')) return;
  document.getElementById('newPollQuestion').value = '';
  pollOptionCount = 2;
  const builder = document.getElementById('pollOptionsBuilder');
  builder.innerHTML = '';
  for (let i=0; i<2; i++) addPollOptionField();
  document.getElementById('addPollModal').classList.remove('hidden');
  setTimeout(() => document.getElementById('newPollQuestion').focus(), 50);
}
window.addPollOptionField = () => {
  pollOptionCount++;
  const builder = document.getElementById('pollOptionsBuilder');
  const div = document.createElement('div');
  div.className = 'poll-option-input-row';
  div.id = `po-row-${pollOptionCount}`;
  div.innerHTML = `
    <input type="text" id="po-${pollOptionCount}" placeholder="Option ${pollOptionCount}…">
    ${pollOptionCount > 2 ? `<button class="rm-option-btn" onclick="document.getElementById('po-row-${pollOptionCount}').remove()">✕</button>` : ''}
  `;
  builder.appendChild(div);
  div.querySelector('input')?.focus();
};
window.submitNewPoll = () => {
  if (!requireAuth('create poll')) return;
  const q = document.getElementById('newPollQuestion').value.trim();
  if (!q) { showToast('⚠️ Enter a question'); return; }
  const opts = [];
  document.querySelectorAll('#pollOptionsBuilder input').forEach(inp => {
    const v = inp.value.trim();
    if (v) opts.push({ text:v, votes:0 });
  });
  if (opts.length < 2) { showToast('⚠️ Add at least 2 options'); return; }
  pollsData.push({ id:nextPollId++, question:q, options:opts, votedOption:null });
  addActivity(`Created poll: ${q}`);
  closeModal('addPollModal');
  document.getElementById('statsGrid').innerHTML = buildStatsCards();
  showToast('📊 Poll created!');
};

let activePollId = null, selectedPollOption = null;
window.openVotePollModal = pollId => {
  if (!requireAuth('vote')) return;
  const poll = pollsData.find(p=>p.id===pollId);
  if (!poll) return;
  activePollId = pollId; selectedPollOption = null;
  document.getElementById('pollModalQuestion').innerText = poll.question;
  document.getElementById('pollVoteResult').classList.add('hidden');
  document.getElementById('submitVoteBtn').classList.remove('hidden');
  document.getElementById('pollOptionsContainer').innerHTML = poll.options.map((o,i)=>`
    <div class="poll-option-label" id="pol-${i}" onclick="selectPollOption(${i})">
      <div class="poll-radio" id="prad-${i}"></div>
      <span style="font-size:0.9rem;">${escapeHtml(o.text)}</span>
    </div>`).join('');
  document.getElementById('votePollModal').classList.remove('hidden');
};
window.selectPollOption = i => {
  selectedPollOption = i;
  document.querySelectorAll('[id^="pol-"]').forEach((el,idx) => {
    el.classList.toggle('selected', idx===i);
    const r = document.getElementById(`prad-${idx}`);
    if (r) r.classList.toggle('checked', idx===i);
  });
};
window.submitVote = () => {
  if (selectedPollOption === null) { showToast('⚠️ Select an option first'); return; }
  const poll = pollsData.find(p=>p.id===activePollId);
  if (!poll) return;
  poll.options[selectedPollOption].votes++;
  poll.votedOption = selectedPollOption;
  addActivity(`Voted on: ${poll.question}`);
  const total = poll.options.reduce((s,o)=>s+o.votes,0);
  document.getElementById('pollOptionsContainer').innerHTML = poll.options.map((o,i)=>{
    const pct = Math.round(o.votes/total*100);
    const isV = i===selectedPollOption;
    return `<div style="margin-bottom:0.5rem;">
      <div style="display:flex;justify-content:space-between;font-size:0.85rem;margin-bottom:0.3rem;">
        <span style="font-weight:${isV?700:400};color:${isV?'var(--blue)':'var(--text-mid)'};">${isV?'✓ ':''}${escapeHtml(o.text)}</span>
        <span style="color:var(--text-soft);">${pct}% (${o.votes})</span>
      </div>
      <div style="background:var(--border);border-radius:4px;height:8px;overflow:hidden;">
        <div style="background:${isV?'var(--blue)':'var(--text-soft)'};width:${pct}%;height:100%;border-radius:4px;transition:width 0.5s;"></div>
      </div>
    </div>`;
  }).join('');
  const res = document.getElementById('pollVoteResult');
  res.innerHTML = `<div style="background:#eafaf1;color:var(--green);padding:0.5rem 0.75rem;border-radius:0.75rem;font-size:0.85rem;border-left:3px solid var(--green);">✅ You voted: <strong>${escapeHtml(poll.options[selectedPollOption].text)}</strong></div>`;
  res.classList.remove('hidden');
  document.getElementById('submitVoteBtn').classList.add('hidden');
  document.getElementById('statsGrid').innerHTML = buildStatsCards();
};

// ═══════════════════════════════════════════
// OFFICES
// ═══════════════════════════════════════════
window.submitNewOffice = () => {
  if (!requireAuth('add office')) return;
  if (currentUser.role !== 'faculty') { showToast('❌ Only faculty can add offices'); return; }
  const name = document.getElementById('newOfficeName').value.trim();
  const desc = document.getElementById('newOfficeDesc').value.trim();
  const loc  = document.getElementById('newOfficeLoc').value.trim();
  if (!name) { showToast('⚠️ Enter an office name'); return; }
  officesData[nextOfficeId] = { id:nextOfficeId, name, description:desc||'Campus office.', location:loc||'Main Building', posts:[] };
  // Update station select
  const ss = document.getElementById('stationSelect');
  if (ss) ss.innerHTML = Object.values(officesData).map(o=>`<option value="${o.id}" ${currentUser.officeId===o.id?'selected':''}>${escapeHtml(o.name)}</option>`).join('');
  nextOfficeId++;
  addActivity(`Added office: ${name}`);
  closeModal('addOfficeModal');
  renderOffices();
  showToast('🏢 Office added!');
};

let activeOfficeTab = 'posts';
function showOfficeDetail(id) {
  const office = officesData[id];
  if (!office) return;
  const canPost = currentUser.role==='faculty' && currentUser.officeId===id;
  const facultyInOffice = getFacultyForOffice(id);

  const postsHTML = office.posts.length
    ? office.posts.map(p=>`
        <div class="office-post">
          <div class="office-post-avatar">${escapeHtml((p.authorPic||p.author.charAt(0)).substring(0,2).toUpperCase())}</div>
          <div style="flex:1;">
            <div style="font-weight:700;font-size:0.85rem;">${escapeHtml(p.author)}<span style="font-size:0.7rem;color:var(--text-soft);font-weight:400;margin-left:0.5rem;">${escapeHtml(p.authorRole||'Faculty')}</span><span style="font-size:0.68rem;color:var(--text-soft);margin-left:0.5rem;">${escapeHtml(p.time)}</span></div>
            <span class="post-type-badge ${{'announcement':'badge-announcement','maintenance':'badge-maintenance','event':'badge-event','update':'badge-update'}[p.type]||'badge-announcement'}" style="margin:0.3rem 0;display:inline-block;">${p.type}</span>
            <p style="font-size:0.85rem;color:var(--text-mid);margin-top:0.25rem;">${escapeHtml(p.content)}</p>
          </div>
        </div>`).join('')
    : '<div class="empty-state"><i class="fas fa-newspaper"></i><p>No posts yet in this office.</p></div>';

  const notice = currentUser.role!=='faculty'
    ? '<div class="notice info"><i class="fas fa-info-circle"></i> Only instructors can post in offices.</div>'
    : currentUser.officeId === null || currentUser.officeId === undefined
      ? '<div class="notice warn">⚠️ You have no assigned station yet. Please go to <strong>Settings → Station</strong> and assign yourself to an office first.</div>'
      : currentUser.officeId!==id
        ? `<div class="notice warn">⚠️ You are assigned to <strong>${escapeHtml(officesData[currentUser.officeId]?.name||'another office')}</strong>. You can only post in your assigned station.</div>`
        : '';

  const postForm = canPost ? `
    <div class="post-form-area">
      <label>Post to this office</label>
      <textarea id="officePostContent" rows="3" placeholder="Write an office announcement…"></textarea>
      <select id="officePostType"><option value="announcement">📢 Announcement</option><option value="maintenance">🔧 Maintenance</option><option value="event">🎉 Event</option><option value="update">📝 Update</option></select>
      <button class="btn-primary" onclick="submitOfficePost(${id})" style="margin-top:0.5rem;width:auto;padding:0.6rem 1.4rem;">Post to Office</button>
    </div>` : '';

  // LIVE DIRECTORY — only from registry, no pre-determined data
  const dirHTML = facultyInOffice.length
    ? facultyInOffice.map(f=>{
        const isMe = f.id===currentUser.id;
        return `<div class="faculty-card" style="${isMe?'border-color:var(--blue);background:var(--blue-faint);':''}">
          <div class="faculty-avatar" style="background:${isMe?'var(--blue)':'var(--navy)'};">${escapeHtml(f.pic||f.name.charAt(0).toUpperCase())}</div>
          <div class="faculty-info">
            <div class="faculty-name">${escapeHtml(f.name)}${isMe?'<span class="you-badge">You</span>':''}</div>
            <div class="faculty-role">${escapeHtml(f.role)}</div>
            ${f.email?`<div class="faculty-detail">📧 ${escapeHtml(f.email)}</div>`:''}
            ${f.bio?`<div class="faculty-detail">📝 ${escapeHtml(f.bio)}</div>`:''}
          </div>
        </div>`;
      }).join('')
    : '<div class="empty-state"><i class="fas fa-users"></i><p>No faculty assigned to this office yet.<br><span style="font-size:0.75rem;">Faculty appear here when they set this as their station.</span></p></div>';

  const modal = document.createElement('div');
  modal.className = 'modal-overlay'; modal.id = 'officeModal';
  modal.innerHTML = `
    <div class="modal-content">
      <div class="office-modal-header">
        <h2>${escapeHtml(office.name)}</h2>
        <p><i class="fas fa-map-marker-alt" style="color:var(--blue);"></i> ${escapeHtml(office.location)}</p>
      </div>
      <div class="office-tabs">
        <div class="office-tab active" id="otPosts" onclick="switchOfficeTab('Posts')">📢 Posts</div>
        <div class="office-tab" id="otDirectory" onclick="switchOfficeTab('Directory')">📋 Directory</div>
      </div>
      <div class="office-tab-content active" id="ocPosts">${postsHTML}${notice}${postForm}</div>
      <div class="office-tab-content" id="ocDirectory">${dirHTML}<div class="notice info" style="margin-top:0.5rem;">📌 Directory updates in real time as faculty assign this as their station.</div></div>
      <div style="margin-top:1.25rem;padding-top:1rem;border-top:1px solid var(--border);">
        <button class="cancel-btn" onclick="closeOfficeModal()">Close</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  document.body.style.overflow = 'hidden';
  modal.addEventListener('click', e => { if (e.target===modal) closeOfficeModal(); });
  if (activeOfficeTab==='Directory') switchOfficeTab('Directory');
}
window.switchOfficeTab = tab => {
  activeOfficeTab = tab;
  document.querySelectorAll('.office-tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.office-tab-content').forEach(c=>c.classList.remove('active'));
  document.getElementById(`ot${tab}`)?.classList.add('active');
  document.getElementById(`oc${tab}`)?.classList.add('active');
};
window.submitOfficePost = id => {
  if (!requireAuth('post in office')) return;
  const content = document.getElementById('officePostContent')?.value?.trim();
  const type = document.getElementById('officePostType')?.value;
  if (!content) { showToast('⚠️ Write something first'); return; }
  if (currentUser.role!=='faculty') { showToast('❌ Only faculty can post in offices'); return; }
  if (currentUser.officeId===null || currentUser.officeId===undefined) { showToast('❌ You have no assigned station. Go to Settings → Station first.'); return; }
  if (currentUser.officeId!==id) { showToast(`❌ You can only post in your assigned station`); return; }
  const office = officesData[id];
  const myReg = facultyRegistry.find(f=>f.id===currentUser.id);
  office.posts.unshift({ id:Date.now(), author:currentUser.name, authorPic:currentUser.profilePic||currentUser.name.charAt(0), authorRole:myReg?.role||'Faculty', time:'Just now', content, type, likes:0, liked:false, comments:[] });
  addActivity(`Posted in ${office.name}`);
  closeOfficeModal();
  showOfficeDetail(id);
  showToast('✅ Posted!');
};
window.closeOfficeModal = () => {
  document.getElementById('officeModal')?.remove();
  document.body.style.overflow = '';
};
function renderOffices(filter='') {
  const grid = document.getElementById('officesGrid');
  if (!grid) return;
  const list = Object.values(officesData).filter(o=>o.name.toLowerCase().includes(filter.toLowerCase()));
  grid.innerHTML = list.length
    ? list.map(o=>`
        <div class="office-card" data-office-id="${o.id}">
          <div>
            <div class="office-title">${escapeHtml(o.name)}</div>
            <div class="office-description">${escapeHtml(o.description)}</div>
            <div class="office-meta"><i class="fas fa-map-marker-alt"></i>${escapeHtml(o.location)}</div>
          </div>
          <div class="open-badge">Open <i class="fas fa-arrow-right"></i></div>
        </div>`).join('')
    : `<div class="empty-state"><i class="fas fa-building"></i><p>${filter?'No offices match your search.':'No offices yet — click <strong>Add Office</strong> to create one.'}</p></div>`;
  grid.querySelectorAll('.office-card').forEach(card=>{
    card.addEventListener('click',()=>{ activeOfficeTab='posts'; showOfficeDetail(parseInt(card.dataset.officeId)); });
  });
}

// ═══════════════════════════════════════════
// VIEWS
// ═══════════════════════════════════════════
function showView(view) {
  ['home','departments','freedom','groups','about','settings'].forEach(v=>document.getElementById(v+'View').classList.add('hidden'));
  document.getElementById(view+'View').classList.remove('hidden');
  if (view==='home') { document.getElementById('statsGrid').innerHTML = buildStatsCards(); renderHomePosts(); }
  else if (view==='departments') renderOffices();
  else if (view==='freedom') renderFreedomPosts();
  else if (view==='groups') renderGroupsGrid();
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active', n.dataset.view===view));
}

// ═══════════════════════════════════════════
// CREATE POST
// ═══════════════════════════════════════════
let currentPostTarget = 'home';
function openPostModal(target) {
  if (!requireAuth('post')) return;
  currentPostTarget = target;
  document.getElementById('modalTitle').innerText = target==='home'?'Create Post — Main Feed':'Create Post — Freedom Wall';
  const sel = document.querySelector(`#${target==='home'?'homeTypeSel':'freedomTypeSel'} .type-badge.selected`);
  document.getElementById('postTypeSelect').value = sel?.dataset.type||'announcement';
  document.getElementById('postContentInput').value = '';
  document.getElementById('postModal').classList.remove('hidden');
  setTimeout(()=>document.getElementById('postContentInput').focus(),50);
}
async function submitPost() {
  const content = document.getElementById('postContentInput').value.trim();
  const type = document.getElementById('postTypeSelect').value;
  
  if (!content) { showToast('⚠️ Write something first!'); return; }

  // Show loading state
  const btn = document.getElementById('submitPostBtn');
  const originalText = btn.innerText;
  btn.innerText = 'Posting...';
  btn.disabled = true;

  try {
    // Send data to our new server API
    const response = await fetch('/api/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: content,
        type: type,
        target: currentPostTarget // 'home' or 'freedom'
      })
    });

    if (response.ok) {
      showToast('✅ Posted!');
      closeModal('postModal');
      document.getElementById('postContentInput').value = '';
      
      // Reload posts from the database to show the new one!
      await loadPostsFromDB(); 
    } else {
      showToast('❌ Error saving post.');
    }
  } catch (err) {
    console.error(err);
    showToast('❌ Network error.');
  } finally {
    btn.innerText = originalText;
    btn.disabled = false;
  }
}

// ═══════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════
function renderAuthForm() {
  const fields = currentMode==='login'
    ? `<div class="input-group"><input type="text" id="loginEmail" class="input-field" placeholder="Email" autocomplete="email"></div>
       <div class="input-group"><input type="password" id="loginPassword" class="input-field" placeholder="Password" autocomplete="current-password"></div>`
    : `<div class="input-group"><input type="text" id="signupName" class="input-field" placeholder="Full name"></div>
       <div class="input-group"><input type="email" id="signupEmail" class="input-field" placeholder="Email" autocomplete="email"></div>
       <div class="input-group"><input type="password" id="signupPassword" class="input-field" placeholder="Password" autocomplete="new-password"></div>
       <div style="margin-bottom:0.75rem;">
         <div style="font-size:0.82rem;font-weight:600;color:var(--text-mid);margin-bottom:0.4rem;">I am a:</div>
         <div class="role-picker">
           <label class="role-pick-opt" id="rp-student"><input type="radio" name="roleRadio" value="student" checked style="display:none" onchange="toggleRoleField()"> <span class="role-pick-icon">🎓</span><span class="role-pick-label">Student</span></label>
           <label class="role-pick-opt" id="rp-faculty"><input type="radio" name="roleRadio" value="faculty" style="display:none" onchange="toggleRoleField()"> <span class="role-pick-icon">👨‍🏫</span><span class="role-pick-label">Faculty</span></label>
         </div>
       </div>
       <div id="studentIdGroup" class="input-group"><input type="text" id="signupStudentId" class="input-field" placeholder="Student ID (e.g. 2021-12345)"></div>
       <div id="facultyCodeGroup" class="input-group" style="display:none;"><input type="text" id="signupFacultyCode" class="input-field" placeholder="Faculty Access Code (ask your admin)"></div>
       <div class="checkbox-group"><input type="checkbox" id="termsAgree"> <label for="termsAgree">I agree to the <a onclick="openLegalModal('terms')" style="color:var(--blue);cursor:pointer;font-weight:700;">Terms of Service</a> &amp; <a onclick="openLegalModal('privacy')" style="color:var(--blue);cursor:pointer;font-weight:700;">Privacy Policy</a></label></div>`;
  document.getElementById('dynamicFormFields').innerHTML = fields;
  document.getElementById('authSubmitBtn').innerText = currentMode==='login'?'Log in':'Sign up';
  document.getElementById('authSub').innerText = currentMode==='login'?'Sign in to your account':'Create your account';
  document.getElementById('authError').innerText = '';
  document.getElementById('toggleAuthLink').innerHTML = currentMode==='login'
    ? `No account? <a id="sw2">Sign up</a> &nbsp;·&nbsp; <a id="guestBtn" href="#">Continue as guest</a>`
    : `Have an account? <a id="sw1">Log in</a>`;
  document.getElementById('sw2')?.addEventListener('click', e=>{e.preventDefault();setMode('signup');});
  document.getElementById('sw1')?.addEventListener('click', e=>{e.preventDefault();setMode('login');});
  document.getElementById('guestBtn')?.addEventListener('click', e=>{e.preventDefault();guestLogin();});
}
function setMode(m) { currentMode=m; renderAuthForm(); if(m==='signup') setTimeout(()=>{ document.querySelectorAll('.role-pick-opt')[0]?.classList.add('selected'); },10); }
function guestLogin() {
  currentUser = { id:99, name:'Guest', email:'guest@ucentral.edu', role:'guest', bio:'', password:'guest', officeId:null, profilePic:'G', activityHistory:[] };
  addActivity('Browsing as guest'); showDashboard();
}
// Simple in-memory user store (in real app: server-side auth)
let registeredUsers = [];
function handleLogin(email, pwd) {
  if (!email||!pwd) { document.getElementById('authError').innerText='Enter your credentials'; return; }
  const user = registeredUsers.find(u => u.email.toLowerCase()===email.toLowerCase() && u.password===pwd);
  if (!user) { document.getElementById('authError').innerText='❌ Incorrect email or password. Please sign up first.'; return; }
  currentUser = { ...user, activityHistory: user.activityHistory||[] };
  addActivity('Logged in'); showDashboard();
}
const FACULTY_ACCESS_CODE = 'FACULTY2024'; // Admin sets this code
function handleSignup(name, email, pwd, role, terms) {
  if (!name||!email||!pwd) { document.getElementById('authError').innerText='All fields required'; return; }
  if (!terms) { document.getElementById('authError').innerText='You must agree to the Terms'; return; }
  if (pwd.length<4) { document.getElementById('authError').innerText='Password must be at least 4 characters'; return; }
  if (role==='student') {
    const sid = document.getElementById('signupStudentId')?.value?.trim();
    if (!sid) { document.getElementById('authError').innerText='Please enter your Student ID'; return; }
    if (!/^\d{4}-\d{4,6}$/.test(sid)) { document.getElementById('authError').innerText='Student ID format: YYYY-NNNNN (e.g. 2021-12345)'; return; }
  }
  if (role==='faculty') {
    const code = document.getElementById('signupFacultyCode')?.value?.trim();
    if (!code) { document.getElementById('authError').innerText='Faculty access code required'; return; }
    if (code !== FACULTY_ACCESS_CODE) { document.getElementById('authError').innerText='❌ Invalid faculty access code. Contact your administrator.'; return; }
  }
  const existing = registeredUsers.find(u => u.email.toLowerCase()===email.toLowerCase());
  if (existing) { document.getElementById('authError').innerText='❌ An account with this email already exists. Please log in.'; return; }
  const newUser = { id:Date.now(), name, email, role, bio:'', password:pwd, officeId:null,
    profilePic:name.charAt(0).toUpperCase(), activityHistory:[],
    studentId: role==='student'?document.getElementById('signupStudentId')?.value?.trim():null };
  registeredUsers.push(newUser);
  currentUser = { ...newUser };
  addActivity(`Signed up as ${role}`); showDashboard();
}
window.toggleRoleField = () => {
  const role = document.querySelector('input[name="roleRadio"]:checked')?.value;
  document.getElementById('studentIdGroup').style.display = role==='student'?'block':'none';
  document.getElementById('facultyCodeGroup').style.display = role==='faculty'?'block':'none';
  document.querySelectorAll('.role-pick-opt').forEach(el => {
    el.classList.toggle('selected', el.querySelector('input').value===role);
  });
};
function onAuthSubmit(e) {
  e.preventDefault();
  if (currentMode==='login') handleLogin(document.getElementById('loginEmail')?.value||'', document.getElementById('loginPassword')?.value||'');
  else handleSignup(document.getElementById('signupName')?.value||'', document.getElementById('signupEmail')?.value||'', document.getElementById('signupPassword')?.value||'', document.querySelector('input[name="roleRadio"]:checked')?.value||'student', document.getElementById('termsAgree')?.checked||false);
  // Note: role is also read directly inside handleSignup for validation
}

// ═══════════════════════════════════════════
// DASHBOARD SETUP
// ═══════════════════════════════════════════
function showDashboard() {
  document.getElementById('authPage').classList.add('hidden');
  document.getElementById('dashboardPage').classList.remove('hidden');
  document.getElementById('profileName').value = currentUser.name;
  document.getElementById('profileEmail').value = currentUser.email;
  document.getElementById('profileBio').value = currentUser.bio||'';
  const ss = document.getElementById('stationSelect');
  if (ss) ss.innerHTML = Object.values(officesData).map(o=>`<option value="${o.id}" ${currentUser.officeId===o.id?'selected':''}>${escapeHtml(o.name)}</option>`).join('');
  updateUserUI(); upsertCurrentUserInRegistry(); renderHistory(); showView('home');
}
function updateUserUI() {
  const init = currentUser.name.charAt(0).toUpperCase();
  ['homeUserPic','freedomUserPic'].forEach(id=>{ const el=document.getElementById(id); if(el){el.innerText=init;} });
  document.getElementById('dashboardUserName').innerText = currentUser.name.split(' ')[0];
  document.getElementById('dashboardRoleBadge').innerText = currentUser.role==='faculty'?'Faculty':currentUser.role==='guest'?'Guest':'Student';
  const preview = document.getElementById('profilePicPreview');
  if (preview) {
    if (profilePicBase64) { preview.style.backgroundImage=`url(${profilePicBase64})`; preview.style.backgroundSize='cover'; preview.innerText=''; }
    else { preview.style.backgroundImage=''; preview.innerText=init; }
  }
  const isFac = currentUser.role==='faculty';
  const guest = isGuest();
  document.getElementById('stationMenuItem').style.display = isFac?'flex':'none';
  document.getElementById('stationTab').style.display = isFac?'block':'none';
  // Hide Add Office button for non-faculty
  const aob = document.getElementById('addOfficeBtn');
  if (aob) aob.style.display = (currentUser.role==='faculty') ? '' : 'none';
  // Guest mode top banner
  const gmb = document.getElementById('guestModeBanner');
  if (gmb) gmb.style.display = guest ? 'flex' : 'none';
  // Toggle post boxes vs guest banners
  const hcb = document.getElementById('homeCreateBox');
  const fcb = document.getElementById('freedomCreateBox');
  const ghb = document.getElementById('guestBannerHome');
  const gfb = document.getElementById('guestBannerFreedom');
  if (hcb) hcb.style.display = guest ? 'none' : '';
  if (fcb) fcb.style.display = guest ? 'none' : '';
  if (ghb) ghb.style.display = guest ? 'flex' : 'none';
  if (gfb) gfb.style.display = guest ? 'flex' : 'none';
  // Show guest badge in role badge
  document.getElementById('dashboardRoleBadge').innerText = isFac?'Faculty':guest?'Guest':'Student';
  // Disable/style settings for guest
  const settingsLinks = document.querySelectorAll('[data-setting]');
  settingsLinks.forEach(l => { if (guest && l.dataset.setting!=='history') { l.style.opacity='0.4'; l.style.pointerEvents='none'; } else { l.style.opacity=''; l.style.pointerEvents=''; } });
}

// ═══════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════
function switchTab(id) {
  if (isGuest() && id!=='history') { requireAuth('settings'); return; }
  document.querySelectorAll('.settings-tab').forEach(t=>t.classList.remove('active'));
  document.querySelector(`.settings-tab[data-tab="${id}"]`)?.classList.add('active');
  ['profile','station','password','history'].forEach(t=>document.getElementById(t+'Settings').classList.add('hidden'));
  document.getElementById(id+'Settings').classList.remove('hidden');
  if (id==='history') renderHistory();
}
function saveProfile() {
  if (!requireAuth('edit profile')) return;
  const name = document.getElementById('profileName').value.trim();
  const email = document.getElementById('profileEmail').value.trim();
  if (!name) { showToast('⚠️ Name cannot be empty'); return; }
  currentUser.name=name; currentUser.email=email||currentUser.email; currentUser.bio=document.getElementById('profileBio').value;
  // Sync back to registered users store
  const stored = registeredUsers.find(u=>u.id===currentUser.id);
  if (stored) { stored.name=currentUser.name; stored.email=currentUser.email; stored.bio=currentUser.bio; }
  addActivity('Updated profile');
  const el=document.getElementById('profileSuccess'); el.classList.remove('hidden'); setTimeout(()=>el.classList.add('hidden'),3000);
  upsertCurrentUserInRegistry(); updateUserUI();
}
function saveStation() {
  if (!requireAuth('change station')) return;
  if (currentUser.role!=='faculty') { showToast('❌ Only faculty can change station'); return; }
  const newId = parseInt(document.getElementById('stationSelect').value);
  if (!officesData[newId]) { showToast('⚠️ No offices available yet. Add an office first.'); return; }
  currentUser.officeId=newId; addActivity(`Changed station to ${officesData[newId]?.name}`);
  upsertCurrentUserInRegistry();
  const stored = registeredUsers.find(u=>u.id===currentUser.id);
  if (stored) stored.officeId = currentUser.officeId;
  const el=document.getElementById('stationSuccess'); el.classList.remove('hidden'); setTimeout(()=>el.classList.add('hidden'),3000);
  showToast(`✅ Station set to ${officesData[newId]?.name}`);
}
function changePassword() {
  const curr=document.getElementById('currentPassword').value;
  const newP=document.getElementById('newPassword').value;
  const conf=document.getElementById('confirmPassword').value;
  if (curr!==currentUser.password) { showToast('❌ Current password incorrect'); return; }
  if (newP.length<4) { showToast('❌ Password too short'); return; }
  if (newP!==conf) { showToast('❌ Passwords do not match'); return; }
  currentUser.password=newP; addActivity('Changed password');
  const stored = registeredUsers.find(u=>u.id===currentUser.id);
  if (stored) stored.password = newP;
  ['currentPassword','newPassword','confirmPassword'].forEach(id=>document.getElementById(id).value='');
  const el=document.getElementById('passwordSuccess'); el.classList.remove('hidden'); setTimeout(()=>el.classList.add('hidden'),3000);
}
function renderHistory() {
  const list=document.getElementById('historyList'); if(!list) return;
  list.innerHTML = currentUser.activityHistory.length
    ? currentUser.activityHistory.map(item=>`<li class="history-item"><span>${escapeHtml(item.action)}</span><span style="color:var(--text-soft);font-size:0.75rem;">${escapeHtml(item.timestamp)}</span></li>`).join('')
    : '<li class="history-item" style="color:var(--text-soft);">No activity yet</li>';
}
function logout() {
  addActivity('Logged out'); profilePicBase64=null;
  // Reset to clean unauthenticated state
  currentUser = { id:99, name:'Guest', email:'guest@ucentral.edu', role:'guest', bio:'', password:'guest', officeId:null, profilePic:'G', activityHistory:[] };
  document.getElementById('dashboardPage').classList.add('hidden');
  document.getElementById('authPage').classList.remove('hidden');
  setMode('login');
}

// ═══════════════════════════════════════════
// LEGAL MODAL
// ═══════════════════════════════════════════
const LEGAL_CONTENT = {
  terms: {
    title: 'Terms of Service',
    body: `<h4 style="margin-bottom:0.5rem;color:var(--navy);">1. Acceptance of Terms</h4>
<p>By accessing U-Central, you agree to be bound by these Terms of Service. If you disagree, please do not use the platform.</p>
<h4 style="margin:1rem 0 0.5rem;color:var(--navy);">2. User Conduct</h4>
<p>You agree to use U-Central only for lawful purposes. You must not post content that is harmful, offensive, or violates others' rights. Harassment, hate speech, and impersonation are strictly prohibited.</p>
<h4 style="margin:1rem 0 0.5rem;color:var(--navy);">3. Account Responsibility</h4>
<p>You are responsible for maintaining the confidentiality of your account. Notify administrators immediately of any unauthorized use.</p>
<h4 style="margin:1rem 0 0.5rem;color:var(--navy);">4. Faculty Verification</h4>
<p>Faculty accounts require a valid access code issued by the institution. Misrepresenting your role is grounds for immediate account termination.</p>
<h4 style="margin:1rem 0 0.5rem;color:var(--navy);">5. Content Ownership</h4>
<p>You retain ownership of content you post but grant U-Central a license to display it within the platform.</p>
<h4 style="margin:1rem 0 0.5rem;color:var(--navy);">6. Termination</h4>
<p>Accounts violating these terms may be suspended or terminated without prior notice.</p>`
  },
  privacy: {
    title: 'Privacy Policy',
    body: `<h4 style="margin-bottom:0.5rem;color:var(--navy);">1. Information We Collect</h4>
<p>We collect your name, email, and role during registration. Activity within the platform (posts, votes, comments) is also stored.</p>
<h4 style="margin:1rem 0 0.5rem;color:var(--navy);">2. How We Use Your Information</h4>
<p>Your information is used solely to operate U-Central. We do not sell, trade, or share your personal data with third parties.</p>
<h4 style="margin:1rem 0 0.5rem;color:var(--navy);">3. Data Security</h4>
<p>We implement reasonable security measures to protect your data. However, no system is 100% secure — please use a strong password.</p>
<h4 style="margin:1rem 0 0.5rem;color:var(--navy);">4. Cookies</h4>
<p>U-Central may use session cookies to maintain your login state. No third-party tracking cookies are used.</p>
<h4 style="margin:1rem 0 0.5rem;color:var(--navy);">5. Student ID Data</h4>
<p>Student IDs are used only for identity verification purposes and are not shared outside the institution.</p>
<h4 style="margin:1rem 0 0.5rem;color:var(--navy);">6. Your Rights</h4>
<p>You may request deletion of your account and associated data at any time by contacting support.</p>`
  }
};
window.openLegalModal = (type) => {
  const c = LEGAL_CONTENT[type];
  document.getElementById('legalModalTitle').innerText = c.title;
  document.getElementById('legalModalBody').innerHTML = c.body;
  document.getElementById('legalModal').classList.remove('hidden');
};

// ═══════════════════════════════════════════
// GROUPS / ORGANIZATIONS
// ═══════════════════════════════════════════
let selectedGroupColor = '#1a2e42';
let groupFilter = 'all';
let groupSearchTerm = '';

const ORG_ICONS = { 'Student Organization':'🏫','Academic Club':'📚','Sports':'⚽','Arts & Culture':'🎨','Community Service':'🤝','Tech & Innovation':'💻','Other':'🌟' };

window.submitCreateGroup = () => {
  const name = document.getElementById('newGroupName').value.trim();
  const cat  = document.getElementById('newGroupCategory').value;
  const desc = document.getElementById('newGroupDesc').value.trim();
  const priv = document.getElementById('newGroupPrivacy').value;
  if (!name) { showToast('⚠️ Enter a group name'); return; }
  const id = nextOrgId++;
  orgsData[id] = { id, name, description:desc||'A campus group.', category:cat, privacy:priv,
    coverColor:selectedGroupColor, members:[currentUser.id], posts:[], creatorId:currentUser.id,
    creatorName:currentUser.name, createdAt:new Date().toLocaleDateString() };
  addActivity(`Created group: ${name}`);
  closeModal('createGroupModal');
  renderGroupsGrid();
  showToast(`👥 "${name}" created!`);
};

function renderGroupsGrid(search='', cat='') {
  const grid = document.getElementById('groupsGrid');
  if (!grid) return;
  const s = search || groupSearchTerm;
  const c = cat || groupFilter;
  let list = Object.values(orgsData);
  if (s) list = list.filter(g => g.name.toLowerCase().includes(s.toLowerCase()) || g.description.toLowerCase().includes(s.toLowerCase()));
  if (c && c!=='all') list = list.filter(g => g.category===c);
  if (!list.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;"><i class="fas fa-users"></i><p>${s||c!=='all'?'No groups match your search.':'No groups yet — be the first to create one!'}</p></div>`;
    grid.className = '';
    return;
  }
  grid.className = 'groups-grid-layout';
  grid.innerHTML = list.map(g => {
    const isMember = g.members.includes(currentUser.id);
    const icon = ORG_ICONS[g.category]||'🌟';
    return `
      <div class="group-card" onclick="showGroupDetail(${g.id})">
        <div class="group-cover" style="background:${g.coverColor};">
          <div class="group-cover-icon">${icon}</div>
        </div>
        <div class="group-body">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:0.5rem;">
            <div>
              <div class="group-name">${escapeHtml(g.name)}</div>
              <div class="group-cat">${escapeHtml(g.category)} ${g.privacy==='private'?'🔒':''}</div>
            </div>
          </div>
          <div class="group-desc">${escapeHtml(g.description)}</div>
          <div class="group-footer">
            <div class="group-stats">
              <span><i class="fas fa-users" style="font-size:0.65rem;"></i> ${g.members.length}</span>
              <span><i class="fas fa-newspaper" style="font-size:0.65rem;"></i> ${g.posts.length}</span>
            </div>
            <button class="group-join-btn ${isMember?'joined':'join'}" onclick="event.stopPropagation();toggleJoinGroup(${g.id})">
              ${isMember ? '✓ Joined' : '+ Join'}
            </button>
          </div>
        </div>
      </div>`;
  }).join('');
}

window.toggleJoinGroup = (id) => {
  if (!requireAuth('join group')) return;
  const g = orgsData[id];
  if (!g) return;
  const idx = g.members.indexOf(currentUser.id);
  if (idx > -1) {
    if (g.creatorId===currentUser.id) { showToast('❌ You cannot leave a group you created'); return; }
    g.members.splice(idx,1);
    addActivity(`Left group: ${g.name}`);
    showToast(`Left "${g.name}"`);
  } else {
    g.members.push(currentUser.id);
    addActivity(`Joined group: ${g.name}`);
    showToast(`✅ Joined "${g.name}"!`);
  }
  renderGroupsGrid();
};

let activeGroupTab = 'feed';
window.showGroupDetail = (id) => {
  const g = orgsData[id];
  if (!g) return;
  if (g.privacy==='private' && (isGuest() || !g.members.includes(currentUser.id))) {
    showToast('🔒 This is a private group. Log in and join to view content.'); return;
  }
  const isMember = g.members.includes(currentUser.id);
  const isCreator = g.creatorId===currentUser.id;
  const icon = ORG_ICONS[g.category]||'🌟';

  const feedHTML = g.posts.length
    ? g.posts.map(p=>`
        <div class="post-card" style="margin-bottom:0.75rem;">
          <div class="post-header">
            <div class="post-author-info">
              <div class="post-avatar" style="background:${g.coverColor};">${escapeHtml((p.authorPic||p.author.charAt(0)).substring(0,2))}</div>
              <div><div style="font-weight:700;font-size:0.88rem;">${escapeHtml(p.author)}</div><div style="font-size:0.7rem;color:var(--text-soft);">${escapeHtml(p.time)}</div></div>
            </div>
            <span class="post-type-badge badge-${p.type||'announcement'}">${p.type||'post'}</span>
          </div>
          <div class="post-content">${escapeHtml(p.content)}</div>
          <div style="display:flex;gap:0.25rem;margin-top:0.6rem;padding-top:0.5rem;border-top:1px solid var(--border-light);">
            <button class="action-btn ${p.liked?'liked':''}" onclick="toggleGroupLike(${id},${p.id})"><i class="fas fa-heart"></i> ${p.likes}</button>
          </div>
        </div>`).join('')
    : '<div class="empty-state"><i class="fas fa-stream"></i><p>No posts yet in this group.</p></div>';

  const postFormHTML = isMember ? `
    <div class="post-form-area" style="margin-bottom:1rem;">
      <label>Post to ${escapeHtml(g.name)}</label>
      <textarea id="groupPostContent-${id}" rows="3" placeholder="Share something with the group…"></textarea>
      <div style="display:flex;gap:0.5rem;margin-top:0.5rem;align-items:center;">
        <select id="groupPostType-${id}" style="flex:1;padding:0.55rem;border:1.5px solid var(--border);border-radius:var(--radius-sm);font-family:inherit;">
          <option value="announcement">📢 Announcement</option><option value="event">🎉 Event</option><option value="update">📝 Update</option>
        </select>
        <button class="btn-primary" onclick="submitGroupPost(${id})" style="width:auto;margin:0;padding:0.55rem 1.2rem;">Post</button>
      </div>
    </div>` : '<div class="notice info" style="margin-bottom:1rem;">Join this group to post.</div>';

  const membersHTML = `<div style="font-size:0.82rem;color:var(--text-soft);margin-bottom:0.75rem;">${g.members.length} member${g.members.length!==1?'s':''}</div>
    <div class="faculty-card" style="align-items:center;">
      <div class="faculty-avatar" style="background:${g.coverColor};font-size:0.85rem;">${escapeHtml(g.creatorName.charAt(0))}</div>
      <div><div class="faculty-name">${escapeHtml(g.creatorName)} <span class="you-badge" style="background:var(--orange);">Admin</span>${g.creatorId===currentUser.id?'<span class="you-badge">You</span>':''}</div><div class="faculty-role">Group Creator</div></div>
    </div>
    <div class="notice info">👥 ${g.members.length} member${g.members.length!==1?'s':''} in this group.</div>`;

  const modal = document.createElement('div');
  modal.className = 'modal-overlay'; modal.id = 'groupModal';
  modal.innerHTML = `
    <div class="modal-content" style="padding:0;overflow:hidden;">
      <div class="group-modal-cover" style="background:${g.coverColor};">
        <div class="group-modal-icon">${icon}</div>
      </div>
      <div style="padding:0.75rem 1.25rem 0;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:0.5rem;">
          <div>
            <div style="font-family:'DM Serif Display',serif;font-size:1.2rem;color:var(--navy);">${escapeHtml(g.name)}</div>
            <div style="font-size:0.78rem;color:var(--text-soft);">${escapeHtml(g.category)} · ${g.privacy==='private'?'🔒 Private':'🌐 Public'} · ${g.members.length} members</div>
          </div>
          <button class="group-join-btn ${isMember?'joined':'join'}" onclick="toggleJoinGroup(${id});document.getElementById('groupModal')?.remove();document.body.style.overflow='';showGroupDetail(${id});">
            ${isMember?(isCreator?'✓ Owner':'✓ Joined'):'+ Join'}
          </button>
        </div>
        <p style="font-size:0.83rem;color:var(--text-mid);margin-top:0.4rem;">${escapeHtml(g.description)}</p>
      </div>
      <div class="office-tabs" style="margin:0.75rem 1.25rem 0;border-bottom:2px solid var(--border);">
        <div class="office-tab active" id="gtFeed" onclick="switchGroupTab('Feed',${id})">📰 Feed</div>
        <div class="office-tab" id="gtMembers" onclick="switchGroupTab('Members',${id})">👥 Members</div>
        ${isCreator?`<div class="office-tab" id="gtManage" onclick="switchGroupTab('Manage',${id})">⚙️ Manage</div>`:''}
      </div>
      <div style="padding:0 1.25rem 1.25rem;max-height:45vh;overflow-y:auto;">
        <div id="gcFeed" class="office-tab-content active" style="margin-top:0.75rem;">${postFormHTML}${feedHTML}</div>
        <div id="gcMembers" class="office-tab-content" style="margin-top:0.75rem;">${membersHTML}</div>
        ${isCreator?`<div id="gcManage" class="office-tab-content" style="margin-top:0.75rem;">
          <div class="notice warn" style="margin-bottom:1rem;">⚠️ Danger zone — these actions are permanent.</div>
          <button onclick="deleteGroup(${id})" style="background:var(--red);color:white;border:none;padding:0.6rem 1.2rem;border-radius:var(--radius);cursor:pointer;font-family:inherit;font-weight:700;">🗑️ Delete This Group</button>
        </div>`:''}
      </div>
      <div style="padding:0.75rem 1.25rem;border-top:1px solid var(--border);">
        <button class="cancel-btn" onclick="closeGroupModal()">Close</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  document.body.style.overflow = 'hidden';
  modal.addEventListener('click', e => { if (e.target===modal) closeGroupModal(); });
};
window.switchGroupTab = (tab, id) => {
  document.querySelectorAll('#groupModal .office-tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('#groupModal .office-tab-content').forEach(c=>c.classList.remove('active'));
  document.getElementById(`gt${tab}`)?.classList.add('active');
  document.getElementById(`gc${tab}`)?.classList.add('active');
};
window.submitGroupPost = (id) => {
  if (!requireAuth('group post')) return;
  const content = document.getElementById(`groupPostContent-${id}`)?.value?.trim();
  const type = document.getElementById(`groupPostType-${id}`)?.value||'announcement';
  if (!content) { showToast('⚠️ Write something first'); return; }
  const g = orgsData[id];
  if (!g) return;
  if (!g.members.includes(currentUser.id)) { showToast('❌ Join the group to post'); return; }
  g.posts.unshift({ id:Date.now(), author:currentUser.name, authorPic:currentUser.profilePic||currentUser.name.charAt(0), time:'Just now', content, type, likes:0, liked:false });
  addActivity(`Posted in group: ${g.name}`);
  closeGroupModal();
  showGroupDetail(id);
  showToast('✅ Posted to group!');
};
window.toggleGroupLike = (gid, pid) => {
  if (!requireAuth('like')) return;
  const g = orgsData[gid]; if (!g) return;
  const p = g.posts.find(x=>x.id===pid); if (!p) return;
  p.liked=!p.liked; p.likes+=p.liked?1:-1;
  closeGroupModal(); showGroupDetail(gid);
};
window.deleteGroup = (id) => {
  if (!requireAuth('delete group')) return;
  const g = orgsData[id];
  if (!g) return;
  if (g.creatorId !== currentUser.id) { showToast('❌ Only the group creator can delete it'); return; }
  if (!confirm(`Delete "${g.name}" permanently? This cannot be undone.`)) return;
  const name = g.name;
  delete orgsData[id];
  addActivity(`Deleted group: ${name}`);
  closeGroupModal();
  renderGroupsGrid();
  showToast(`🗑️ Group deleted`);
};
window.closeGroupModal = () => {
  document.getElementById('groupModal')?.remove();
  document.body.style.overflow = '';
};

// ═══════════════════════════════════════════
// EVENT LISTENERS
// ═══════════════════════════════════════════
document.getElementById('profilePicInput')?.addEventListener('change', e=>{
  const file=e.target.files[0]; if(!file) return;
  const r=new FileReader(); r.onload=ev=>{ profilePicBase64=ev.target.result; updateUserUI(); }; r.readAsDataURL(file);
});
document.getElementById('homeFilterBar').addEventListener('click', e=>{
  const c=e.target.closest('.filter-chip'); if(!c) return;
  document.querySelectorAll('#homeFilterBar .filter-chip').forEach(x=>x.classList.remove('active'));
  c.classList.add('active'); homeFilter=c.dataset.filter; renderHomePosts();
});
document.getElementById('freedomFilterBar').addEventListener('click', e=>{
  const c=e.target.closest('.filter-chip'); if(!c) return;
  document.querySelectorAll('#freedomFilterBar .filter-chip').forEach(x=>x.classList.remove('active'));
  c.classList.add('active'); freedomFilter=c.dataset.filter; renderFreedomPosts();
});
['homeTypeSel','freedomTypeSel'].forEach(selId=>{
  document.getElementById(selId).addEventListener('click', e=>{
    const b=e.target.closest('.type-badge'); if(!b) return;
    document.querySelectorAll(`#${selId} .type-badge`).forEach(x=>x.classList.remove('selected'));
    b.classList.add('selected');
  });
});
document.getElementById('authForm').addEventListener('submit', onAuthSubmit);
document.getElementById('googleBtn').addEventListener('click', ()=>{
  // Simulate Google OAuth - create/find user
  const gEmail = 'google@ucentral.edu';
  let gUser = registeredUsers.find(u=>u.email===gEmail);
  if (!gUser) {
    gUser = { id:Date.now(), name:'Google User', email:gEmail, role:'student', bio:'', password:'google-oauth', officeId:null, profilePic:'G', activityHistory:[], studentId:'GOOGLE-SSO' };
    registeredUsers.push(gUser);
  }
  currentUser = { ...gUser, activityHistory: gUser.activityHistory||[] };
  addActivity('Logged in with Google'); showDashboard();
});
document.getElementById('openPostModalHomeBtn').addEventListener('click', ()=>openPostModal('home'));
document.getElementById('openPostModalFreedomBtn').addEventListener('click', ()=>openPostModal('freedom'));
document.getElementById('cancelPostBtn').addEventListener('click', ()=>closeModal('postModal'));
document.getElementById('submitPostBtn').addEventListener('click', submitPost);
document.getElementById('postContentInput').addEventListener('keydown', e=>{ if(e.key==='Enter'&&e.ctrlKey){e.preventDefault();submitPost();} });
document.getElementById('saveProfileBtn').addEventListener('click', saveProfile);
document.getElementById('saveStationBtn').addEventListener('click', saveStation);
document.getElementById('changePasswordBtn').addEventListener('click', changePassword);
document.getElementById('logoutBtn').addEventListener('click', logout);
document.getElementById('addOfficeBtn').addEventListener('click', ()=>{
  if (!requireAuth('add office')) return;
  if (currentUser.role !== 'faculty') { showToast('❌ Only faculty can add offices'); return; }
  document.getElementById('newOfficeName').value='';
  document.getElementById('newOfficeDesc').value='';
  document.getElementById('newOfficeLoc').value='';
  document.getElementById('addOfficeModal').classList.remove('hidden');
  setTimeout(()=>document.getElementById('newOfficeName').focus(),50);
});
document.getElementById('userMenuBtn').addEventListener('click', e=>{
  e.stopPropagation(); document.getElementById('userDropdown').classList.toggle('hidden');
});
document.addEventListener('click', ()=>document.getElementById('userDropdown')?.classList.add('hidden'));
document.querySelectorAll('[data-view]').forEach(n=>n.addEventListener('click',()=>showView(n.dataset.view)));
document.querySelectorAll('[data-setting]').forEach(l=>l.addEventListener('click', e=>{
  e.preventDefault(); showView('settings'); switchTab(l.dataset.setting);
  document.getElementById('userDropdown')?.classList.add('hidden');
}));
document.querySelectorAll('.settings-tab').forEach(t=>t.addEventListener('click',()=>switchTab(t.dataset.tab)));
document.getElementById('officeSearchInput').addEventListener('input', e=>renderOffices(e.target.value));

// Groups
document.getElementById('createGroupBtn')?.addEventListener('click', () => {
  if (!requireAuth('create group')) return;
  document.getElementById('newGroupName').value='';
  document.getElementById('newGroupDesc').value='';
  selectedGroupColor='#1a2e42';
  document.querySelectorAll('.color-swatch').forEach(s=>s.classList.toggle('selected',s.dataset.color===selectedGroupColor));
  document.getElementById('createGroupModal').classList.remove('hidden');
  setTimeout(()=>document.getElementById('newGroupName').focus(),50);
});
document.getElementById('colorPicker')?.addEventListener('click', e=>{
  const sw=e.target.closest('.color-swatch'); if(!sw) return;
  selectedGroupColor=sw.dataset.color;
  document.querySelectorAll('.color-swatch').forEach(s=>s.classList.toggle('selected',s.dataset.color===selectedGroupColor));
});
document.getElementById('groupSearchInput')?.addEventListener('input', e=>{ groupSearchTerm=e.target.value; renderGroupsGrid(); });
document.getElementById('groupCategoryFilter')?.addEventListener('click', e=>{
  const c=e.target.closest('.filter-chip'); if(!c) return;
  document.querySelectorAll('#groupCategoryFilter .filter-chip').forEach(x=>x.classList.remove('active'));
  c.classList.add('active'); groupFilter=c.dataset.cat; renderGroupsGrid();
});

// ═══════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════
setMode('login');
// Load data when script starts
loadPostsFromDB();