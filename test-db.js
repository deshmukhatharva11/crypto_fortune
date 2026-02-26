const { Client } = require('pg');

const client = new Client({
    user: 'postgres',
    host: '127.0.0.1',
    database: 'crypto_fortune',
    password: 'password',
    port: 6432,
});

console.log('Connecting to', client.connectionParameters);

client.connect()
    .then(() => {
        console.log('✅ Connected successfully!');
        return client.query('SELECT 1');
    })
    .then(res => {
        console.log('Result:', res.rows[0]);
        client.end();
    })
    .catch(err => {
        console.error('❌ Connection error:', err);
        client.end();
    });
