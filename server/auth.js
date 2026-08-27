const { readAll } = require('./dataStore');

async function resolveActingMember(req) {
  const id =
    (req.body && req.body.actingMemberId) ||
    req.query.actingMemberId ||
    req.headers['x-acting-member-id'];
  if (!id) return null;
  const members = await readAll('members');
  return members.find((m) => m.id === id) || null;
}

module.exports = { resolveActingMember };
