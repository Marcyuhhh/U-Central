-- ============================================================
-- U-Central Database Schema
-- Run this once to set up all tables
-- ============================================================

-- SESSION TABLE
CREATE TABLE IF NOT EXISTS "session" (
    "sid" varchar NOT NULL COLLATE "default",
    "sess" json NOT NULL,
    "expire" timestamp(6) NOT NULL,
    CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
);

CREATE INDEX IF NOT EXISTS "IDX_session_expire"
    ON "session" ("expire");


-- DEPARTMENTS TABLE (Offices)
CREATE TABLE IF NOT EXISTS departments (
    id SERIAL PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    description TEXT DEFAULT '',
    location VARCHAR(150) DEFAULT 'Main Building',
    created_by INTEGER,
    created_at TIMESTAMP DEFAULT NOW()
);


-- USERS TABLE
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'student',
    id_photo_path TEXT,
    bio TEXT DEFAULT '',
    department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Add the foreign key constraint to departments.created_by
ALTER TABLE departments
    ADD CONSTRAINT fk_departments_created_by
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;


-- POSTS TABLE
CREATE TABLE IF NOT EXISTS posts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    department_id INTEGER REFERENCES departments(id) ON DELETE CASCADE,
    post_type VARCHAR(20) NOT NULL,
    post_subtype VARCHAR(30) DEFAULT 'announcement',
    title VARCHAR(250),
    body TEXT NOT NULL,
    flair VARCHAR(50),
    likes INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);


-- POST LIKES TABLE
CREATE TABLE IF NOT EXISTS post_likes (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, post_id)
);


-- COMMENTS TABLE
CREATE TABLE IF NOT EXISTS comments (
    id SERIAL PRIMARY KEY,
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);


-- POLLS TABLE
CREATE TABLE IF NOT EXISTS polls (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    question TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);


-- POLL OPTIONS TABLE
CREATE TABLE IF NOT EXISTS poll_options (
    id SERIAL PRIMARY KEY,
    poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
    option_text VARCHAR(200) NOT NULL,
    votes INTEGER DEFAULT 0
);


-- POLL VOTES TABLE
CREATE TABLE IF NOT EXISTS poll_votes (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
    option_id INTEGER NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, poll_id)
);


-- EVENTS TABLE
CREATE TABLE IF NOT EXISTS events (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    event_date VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);