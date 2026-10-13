const mongoose = require('mongoose');
require('dotenv').config();
const User = require('./models/User');

const roles = ['Farmer','Processor','Distributor','Retailer','Consumer','Regulator'];
const email = process.argv[2];
const role = process.argv[3];

if (!email || !roles.includes(role)) {
  console.log('Usage: node backend/set-user-role.js <email> <role>');
  console.log('Roles: ' + roles.join(', '));
  process.exit(1);
}

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    const user = await User.findOneAndUpdate(
      { email: email.trim().toLowerCase() },
      { $set: { role } },
      { new: true }
    ).select('-password');
    if (!user) throw new Error('User not found: ' + email);
    console.log(`Updated ${user.email} -> ${user.role}`);
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
})();
