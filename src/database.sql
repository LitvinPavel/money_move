create TABLE users(
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL
);

CREATE TABLE refresh_tokens (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(255) NOT NULL,
    expires_at TIMESTAMP NOT NULL
);

create TABLE event(
    id SERIAL PRIMARY KEY,
    type VARCHAR(255),
    description VARCHAR(255),
    date DATE,
    payment INTEGER,
    user_id INTEGER,
    FOREIGN KEY (user_id) REFERENCES person (id)
);