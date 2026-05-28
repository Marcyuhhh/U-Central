const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { Pool } = require('pg');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcrypt');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const saltRounds = 10;

// ─────────────────────────────────────────────────────────────
// DATABASE CONNECTION
// Uses DATABASE_URL (single string) when on Render/production.
// Uses individual variables from .env when running locally.
// ─────────────────────────────────────────────────────────────
const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    })
  : new Pool({
      user: process.env.DB_USER,
      host: process.env.DB_HOST,
      database: process.env.DB_NAME,
      password: process.env.DB_PASSWORD,
      port: process.env.DB_PORT || 5432,
    });

pool.connect((err, client, release) => {
    if (err) console.error('Database connection error:', err.stack);
    else console.log('Successfully connected to database');
    if (release) release();
});

// ─────────────────────────────────────────────────────────────
// MIDDLEWARE
// ─────────────────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.json({ limit: '50mb' }));

app.use(session({
    store: new pgSession({
        pool: pool,
        tableName: 'session'
    }),
    secret: process.env.SESSION_SECRET || 'fallback_secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        httpOnly: true
    }
}));

// ─────────────────────────────────────────────────────────────
// FILE UPLOADS
// ─────────────────────────────────────────────────────────────
const uploadDir = path.join(__dirname, 'public/uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'public/uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// ─────────────────────────────────────────────────────────────
// AUTH HELPERS
// ─────────────────────────────────────────────────────────────

// FIX #1: requireLogin now detects API routes and returns JSON 401
// instead of redirecting — a redirect on a fetch() call causes a
// silent failure and the toast shows "❌ Error saving post."
function requireLogin(req, res, next) {
    if (!req.session.user) {
        if (req.path.startsWith('/api/')) {
            return res.status(401).json({ error: 'Not logged in' });
        }
        return res.redirect('/login');
    }
    next();
}

function requireFaculty(req, res, next) {
    if (!req.session.user || req.session.user.role !== 'faculty') {
        return res.status(403).json({ error: 'Faculty only' });
    }
    next();
}

// =============================================================
// PAGE ROUTES
// =============================================================

app.get('/', (req, res) => {
    res.redirect(req.session.user ? '/dashboard' : '/login');
});

app.get('/login', (req, res) => {
    if (req.session.user) return res.redirect('/dashboard');
    res.render('login', { error: null });
});

app.get('/signup', (req, res) => {
    if (req.session.user) return res.redirect('/dashboard');
    res.render('signup', { error: null });
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/login'));
});

app.get('/guest', (req, res) => {
    req.session.user = { id: null, full_name: 'Guest User', role: 'guest' };
    req.session.save(() => res.redirect('/dashboard'));
});

app.get('/dashboard', requireLogin, (req, res) => {
    res.render('dashboard', { user: req.session.user });
});

app.get('/offices', requireLogin, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM departments ORDER BY name ASC'
        );
        res.render('offices', {
            user: req.session.user,
            departments: result.rows
        });
    } catch (err) {
        console.error('Error fetching departments:', err);
        res.render('offices', { user: req.session.user, departments: [] });
    }
});

app.get('/freedom', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT p.id, p.title, p.body, p.flair, p.post_subtype,
                   p.likes, p.created_at, u.full_name, u.role
            FROM posts p
            JOIN users u ON p.user_id = u.id
            WHERE p.post_type = 'freedom'
            ORDER BY p.created_at DESC
        `);
        res.render('freedom', {
            user: req.session.user || null,
            posts: result.rows
        });
    } catch (err) {
        console.error('Error fetching freedom posts:', err);
        res.render('freedom', { user: req.session.user || null, posts: [] });
    }
});

app.get('/groups', (req, res) => {
    res.render('groups', { user: req.session.user || null });
});

app.get('/about', (req, res) => {
    res.render('about', { user: req.session.user || null });
});

app.get('/settings', requireLogin, (req, res) => {
    res.render('settings', { user: req.session.user });
});

app.post('/freedom', requireLogin, async (req, res) => {
    if (req.session.user.role === 'guest') {
        return res.status(403).send("Guests cannot post.");
    }
    try {
        const { title, flair, body } = req.body;
        if (!body || !body.trim()) {
            return res.redirect('/freedom');
        }
        await pool.query(
            `INSERT INTO posts (user_id, post_type, post_subtype, title, body, flair, created_at)
             VALUES ($1, 'freedom', 'announcement', $2, $3, $4, NOW())`,
            [req.session.user.id, title?.trim() || null, body.trim(), flair || null]
        );
        res.redirect('/freedom');
    } catch (err) {
        console.error('Error saving freedom post:', err);
        res.redirect('/freedom');
    }
});

// =============================================================
// AUTH ROUTES
// =============================================================

app.post('/signup', upload.single('IDPhoto'), async (req, res) => {
    try {
        const { fullName, email, password, roleRadio } = req.body;
        const photoPath = req.file ? req.file.path : null;
        const role = roleRadio === 'faculty' ? 'faculty' : 'student';

        if (!fullName || !email || !password) {
            return res.render('signup', { error: 'All fields are required.' });
        }
        if (password.length < 4) {
            return res.render('signup', { error: 'Password must be at least 4 characters.' });
        }

        const hashedPassword = await bcrypt.hash(password, saltRounds);
        const result = await pool.query(
            `INSERT INTO users (full_name, email, password, role, id_photo_path)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, full_name, role`,
            [fullName, email, hashedPassword, role, photoPath]
        );
        const user = result.rows[0];
        req.session.user = { id: user.id, full_name: user.full_name, role: user.role };
        req.session.save(() => res.redirect('/dashboard'));

    } catch (err) {
        if (err.code === '23505') {
            return res.render('signup', { error: 'That email is already registered. Please log in.' });
        }
        console.error('Signup error:', err);
        res.render('signup', { error: 'Something went wrong. Please try again.' });
    }
});

app.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.render('login', { error: 'Please enter your email and password.' });
        }

        const result = await pool.query(
            'SELECT * FROM users WHERE email = $1', [email]
        );
        if (result.rows.length === 0) {
            return res.render('login', { error: 'No account found with that email.' });
        }

        const user = result.rows[0];
        const match = await bcrypt.compare(password, user.password);
        if (!match) {
            return res.render('login', { error: 'Incorrect password. Please try again.' });
        }

        req.session.user = { id: user.id, full_name: user.full_name, role: user.role };
        req.session.save(() => res.redirect('/dashboard'));

    } catch (err) {
        console.error('Login error:', err);
        res.render('login', { error: 'Login failed. Please try again.' });
    }
});

// =============================================================
// API — HOME FEED POSTS
// FIX #2: Removed the two dead duplicate route blocks that were
// shadowing these. Express only executes the FIRST matching route,
// so those blocks at lines 274 and 290 in the original file were
// the only ones that ever ran — but they had the wrong SQL and the
// wrong field names. These are now the single, canonical handlers.
// =============================================================

app.get('/api/posts', async (req, res) => {
    try {
        const { type } = req.query;
        const userId = req.session.user?.id || 0;
        const params = [userId];
        let query = `
            SELECT p.id, p.title, p.body, p.post_subtype AS type,
                   p.flair, p.likes, p.created_at,
                   u.full_name AS author, u.role AS author_role,
                   EXISTS(
                       SELECT 1 FROM post_likes pl
                       WHERE pl.post_id = p.id AND pl.user_id = $1
                   ) AS liked,
                   (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count
            FROM posts p
            JOIN users u ON p.user_id = u.id
            WHERE p.post_type = 'home'
        `;
        if (type && type !== 'all') {
            query += ` AND p.post_subtype = $2`;
            params.push(type);
        }
        query += ` ORDER BY p.created_at DESC LIMIT 50`;
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to load posts' });
    }
});

// FIX #3: Field name was mismatched. app.js sends { content, type, target }
// but the old duplicate handler at line 347 expected { body, type } and
// hardcoded post_type = 'home', ignoring the target field entirely —
// meaning Freedom Wall posts were always saved as home posts.
// This single handler now correctly reads `content` and `target`.
app.post('/api/posts', requireLogin, async (req, res) => {
    if (req.session.user.role === 'guest') {
        return res.status(403).json({ error: 'Guests cannot post' });
    }
    try {
        const { content, type, target } = req.body;
        if (!content?.trim()) return res.status(400).json({ error: 'Post content is required' });

        // `target` is 'home' or 'freedom', sent by app.js
        const postType = (target === 'freedom') ? 'freedom' : 'home';

        const result = await pool.query(
            `INSERT INTO posts (user_id, post_type, post_subtype, body, created_at)
             VALUES ($1, $2, $3, $4, NOW()) RETURNING id`,
            [req.session.user.id, postType, type || 'announcement', content.trim()]
        );
        res.json({ success: true, id: result.rows[0].id });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to create post' });
    }
});

app.delete('/api/posts/:id', requireLogin, async (req, res) => {
    try {
        const result = await pool.query(
            'DELETE FROM posts WHERE id = $1 AND user_id = $2 RETURNING id',
            [req.params.id, req.session.user.id]
        );
        if (result.rows.length === 0) {
            return res.status(403).json({ error: 'Not authorized to delete this post' });
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete post' });
    }
});

// =============================================================
// API — FREEDOM WALL POSTS
// =============================================================

app.get('/api/freedom', async (req, res) => {
    try {
        const userId = req.session.user?.id || 0;
        const result = await pool.query(`
            SELECT p.id, p.title, p.body, p.post_subtype AS type,
                   p.flair, p.likes, p.created_at,
                   u.full_name AS author, u.role AS author_role,
                   EXISTS(
                       SELECT 1 FROM post_likes pl
                       WHERE pl.post_id = p.id AND pl.user_id = $1
                   ) AS liked,
                   (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count
            FROM posts p
            JOIN users u ON p.user_id = u.id
            WHERE p.post_type = 'freedom'
            ORDER BY p.created_at DESC LIMIT 50
        `, [userId]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Failed to load posts' });
    }
});

app.post('/api/freedom', requireLogin, async (req, res) => {
    if (req.session.user.role === 'guest') {
        return res.status(403).json({ error: 'Guests cannot post' });
    }
    try {
        const { title, body, flair, type } = req.body;
        if (!body?.trim()) return res.status(400).json({ error: 'Body is required' });
        const result = await pool.query(
            `INSERT INTO posts (user_id, post_type, post_subtype, title, body, flair, created_at)
             VALUES ($1, 'freedom', $2, $3, $4, $5, NOW()) RETURNING id`,
            [req.session.user.id, type || 'announcement',
             title?.trim() || null, body.trim(), flair || null]
        );
        res.json({ success: true, id: result.rows[0].id });
    } catch (err) {
        res.status(500).json({ error: 'Failed to create post' });
    }
});

// =============================================================
// API — LIKES
// =============================================================

app.post('/api/posts/:id/like', requireLogin, async (req, res) => {
    if (!req.session.user.id) {
        return res.status(403).json({ error: 'Guests cannot like posts' });
    }
    try {
        const postId = req.params.id;
        const userId = req.session.user.id;

        const existing = await pool.query(
            'SELECT 1 FROM post_likes WHERE user_id = $1 AND post_id = $2',
            [userId, postId]
        );
        if (existing.rows.length > 0) {
            await pool.query(
                'DELETE FROM post_likes WHERE user_id = $1 AND post_id = $2',
                [userId, postId]
            );
            await pool.query(
                'UPDATE posts SET likes = GREATEST(likes - 1, 0) WHERE id = $1',
                [postId]
            );
            res.json({ liked: false });
        } else {
            await pool.query(
                'INSERT INTO post_likes (user_id, post_id) VALUES ($1, $2)',
                [userId, postId]
            );
            await pool.query(
                'UPDATE posts SET likes = likes + 1 WHERE id = $1',
                [postId]
            );
            res.json({ liked: true });
        }
    } catch (err) {
        res.status(500).json({ error: 'Failed to toggle like' });
    }
});

// =============================================================
// API — COMMENTS
// =============================================================

app.get('/api/posts/:id/comments', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT c.id, c.body, c.created_at, c.parent_id,
                   u.full_name AS author
            FROM comments c
            JOIN users u ON c.user_id = u.id
            WHERE c.post_id = $1
            ORDER BY c.created_at ASC
        `, [req.params.id]);

        const map = {};
        const roots = [];
        result.rows.forEach(r => { map[r.id] = { ...r, replies: [] }; });
        result.rows.forEach(r => {
            if (r.parent_id && map[r.parent_id]) {
                map[r.parent_id].replies.push(map[r.id]);
            } else {
                roots.push(map[r.id]);
            }
        });
        res.json(roots);
    } catch (err) {
        res.status(500).json({ error: 'Failed to load comments' });
    }
});

app.post('/api/posts/:id/comments', requireLogin, async (req, res) => {
    if (!req.session.user.id) {
        return res.status(403).json({ error: 'Guests cannot comment' });
    }
    try {
        const { body, parent_id } = req.body;
        if (!body?.trim()) return res.status(400).json({ error: 'Comment cannot be empty' });
        const result = await pool.query(
            `INSERT INTO comments (post_id, user_id, parent_id, body)
             VALUES ($1, $2, $3, $4) RETURNING id`,
            [req.params.id, req.session.user.id, parent_id || null, body.trim()]
        );
        res.json({ success: true, id: result.rows[0].id });
    } catch (err) {
        res.status(500).json({ error: 'Failed to post comment' });
    }
});

// =============================================================
// API — OFFICES
// =============================================================

app.get('/api/offices', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT d.*,
                (SELECT COUNT(*) FROM posts p WHERE p.department_id = d.id) AS post_count,
                (SELECT COUNT(*) FROM users u WHERE u.department_id = d.id) AS faculty_count
            FROM departments d
            ORDER BY d.name ASC
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Failed to load offices' });
    }
});

app.post('/api/offices', requireLogin, requireFaculty, async (req, res) => {
    try {
        const { name, description, location } = req.body;
        if (!name?.trim()) return res.status(400).json({ error: 'Office name is required' });
        const result = await pool.query(
            `INSERT INTO departments (name, description, location, created_by)
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [name.trim(), description?.trim() || '', location?.trim() || 'Main Building',
             req.session.user.id]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Failed to create office' });
    }
});

app.get('/api/offices/:id/posts', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT p.id, p.body, p.post_subtype AS type,
                   p.likes, p.created_at,
                   u.full_name AS author, u.role AS author_role
            FROM posts p
            JOIN users u ON p.user_id = u.id
            WHERE p.department_id = $1 AND p.post_type = 'office'
            ORDER BY p.created_at DESC
        `, [req.params.id]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Failed to load office posts' });
    }
});

app.post('/api/offices/:id/posts', requireLogin, requireFaculty, async (req, res) => {
    try {
        const { body, type } = req.body;
        if (!body?.trim()) return res.status(400).json({ error: 'Post body is required' });

        const check = await pool.query(
            'SELECT department_id FROM users WHERE id = $1', [req.session.user.id]
        );
        if (parseInt(check.rows[0]?.department_id) !== parseInt(req.params.id)) {
            return res.status(403).json({
                error: 'You can only post in your assigned office. Go to Settings → Station.'
            });
        }

        await pool.query(
            `INSERT INTO posts (user_id, department_id, post_type, post_subtype, body, created_at)
             VALUES ($1, $2, 'office', $3, $4, NOW())`,
            [req.session.user.id, req.params.id, type || 'announcement', body.trim()]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to post to office' });
    }
});

app.get('/api/offices/:id/faculty', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, full_name, bio FROM users
             WHERE department_id = $1 AND role = 'faculty'`,
            [req.params.id]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Failed to load faculty' });
    }
});

// =============================================================
// API — POLLS
// =============================================================

app.get('/api/polls', requireLogin, async (req, res) => {
    try {
        const userId = req.session.user.id || 0;
        const polls = await pool.query(`
            SELECT po.id, po.question, po.created_at,
                   u.full_name AS creator,
                   (SELECT option_id FROM poll_votes
                    WHERE user_id = $1 AND poll_id = po.id) AS voted_option_id
            FROM polls po
            JOIN users u ON po.user_id = u.id
            ORDER BY po.created_at DESC
            LIMIT 10
        `, [userId]);

        const result = [];
        for (const poll of polls.rows) {
            const opts = await pool.query(
                'SELECT id, option_text, votes FROM poll_options WHERE poll_id = $1 ORDER BY id',
                [poll.id]
            );
            result.push({ ...poll, options: opts.rows });
        }
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: 'Failed to load polls' });
    }
});

app.post('/api/polls', requireLogin, async (req, res) => {
    if (!req.session.user.id) {
        return res.status(403).json({ error: 'Guests cannot create polls' });
    }
    try {
        const { question, options } = req.body;
        if (!question?.trim()) {
            return res.status(400).json({ error: 'Question is required' });
        }
        const validOptions = (options || []).filter(o => o?.trim());
        if (validOptions.length < 2) {
            return res.status(400).json({ error: 'At least 2 options are required' });
        }

        const poll = await pool.query(
            'INSERT INTO polls (user_id, question) VALUES ($1, $2) RETURNING id',
            [req.session.user.id, question.trim()]
        );
        const pollId = poll.rows[0].id;

        for (const opt of validOptions) {
            await pool.query(
                'INSERT INTO poll_options (poll_id, option_text) VALUES ($1, $2)',
                [pollId, opt.trim()]
            );
        }
        res.json({ success: true, id: pollId });
    } catch (err) {
        res.status(500).json({ error: 'Failed to create poll' });
    }
});

app.post('/api/polls/:id/vote', requireLogin, async (req, res) => {
    if (!req.session.user.id) {
        return res.status(403).json({ error: 'Guests cannot vote' });
    }
    try {
        const { option_id } = req.body;
        const userId = req.session.user.id;
        const pollId = req.params.id;

        const existing = await pool.query(
            'SELECT 1 FROM poll_votes WHERE user_id = $1 AND poll_id = $2',
            [userId, pollId]
        );
        if (existing.rows.length > 0) {
            return res.status(400).json({ error: 'You have already voted on this poll' });
        }

        await pool.query(
            'INSERT INTO poll_votes (user_id, poll_id, option_id) VALUES ($1, $2, $3)',
            [userId, pollId, option_id]
        );
        await pool.query(
            'UPDATE poll_options SET votes = votes + 1 WHERE id = $1',
            [option_id]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to record vote' });
    }
});

// =============================================================
// API — PERSONAL EVENTS
// =============================================================

app.get('/api/events', requireLogin, async (req, res) => {
    if (!req.session.user.id) return res.json([]);
    try {
        const result = await pool.query(
            'SELECT * FROM events WHERE user_id = $1 ORDER BY created_at DESC',
            [req.session.user.id]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Failed to load events' });
    }
});

app.post('/api/events', requireLogin, async (req, res) => {
    if (!req.session.user.id) {
        return res.status(403).json({ error: 'Guests cannot add events' });
    }
    try {
        const { name, event_date } = req.body;
        if (!name?.trim() || !event_date?.trim()) {
            return res.status(400).json({ error: 'Name and date are required' });
        }
        const result = await pool.query(
            'INSERT INTO events (user_id, name, event_date) VALUES ($1, $2, $3) RETURNING *',
            [req.session.user.id, name.trim(), event_date.trim()]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Failed to add event' });
    }
});

app.delete('/api/events/:id', requireLogin, async (req, res) => {
    try {
        await pool.query(
            'DELETE FROM events WHERE id = $1 AND user_id = $2',
            [req.params.id, req.session.user.id]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete event' });
    }
});

// =============================================================
// API — USER PROFILE / SETTINGS
// =============================================================

app.get('/api/me', requireLogin, (req, res) => {
    res.json(req.session.user);
});

app.put('/api/me', requireLogin, async (req, res) => {
    if (!req.session.user.id) {
        return res.status(403).json({ error: 'Guests cannot edit profile' });
    }
    try {
        const { full_name, bio, department_id } = req.body;
        if (!full_name?.trim()) {
            return res.status(400).json({ error: 'Name is required' });
        }
        const result = await pool.query(
            `UPDATE users
             SET full_name = $1, bio = $2, department_id = $3
             WHERE id = $4
             RETURNING id, full_name, role, bio, department_id`,
            [full_name.trim(), bio?.trim() || '',
             department_id || null, req.session.user.id]
        );
        req.session.user = { ...req.session.user, ...result.rows[0] };
        req.session.save();
        res.json(req.session.user);
    } catch (err) {
        res.status(500).json({ error: 'Failed to update profile' });
    }
});

app.put('/api/me/password', requireLogin, async (req, res) => {
    if (!req.session.user.id) {
        return res.status(403).json({ error: 'Guests cannot change password' });
    }
    try {
        const { current_password, new_password } = req.body;
        if (!current_password || !new_password) {
            return res.status(400).json({ error: 'Both fields are required' });
        }
        if (new_password.length < 4) {
            return res.status(400).json({ error: 'Password must be at least 4 characters' });
        }

        const result = await pool.query(
            'SELECT password FROM users WHERE id = $1', [req.session.user.id]
        );
        const match = await bcrypt.compare(current_password, result.rows[0].password);
        if (!match) {
            return res.status(401).json({ error: 'Current password is incorrect' });
        }

        const hashed = await bcrypt.hash(new_password, saltRounds);
        await pool.query(
            'UPDATE users SET password = $1 WHERE id = $2', [hashed, req.session.user.id]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to change password' });
    }
});

// =============================================================
// START SERVER
// =============================================================
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});