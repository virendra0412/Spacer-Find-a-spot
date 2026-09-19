require('dotenv').config();
const { app } = require('./app');
const sessionOverrunJob = require('./jobs/sessionOverrun.job');

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`Spacer backend listening on :${port}`);
  sessionOverrunJob.start();
});
