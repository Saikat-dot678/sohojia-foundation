function getISTDate() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000; // Convert local to UTC
  const istOffset = 5.5 * 60 * 60 * 1000; // IST offset in ms
  return new Date(utc + istOffset);
}

function getISTDateString() {
  const ist = getISTDate();
  return ist.toISOString().split('T')[0];
}

function getISTTimeString() {
  const ist = getISTDate();
  return ist.toTimeString().split(' ')[0];
}

function getISTDayName() {
  const ist = getISTDate();
  return ist.toLocaleString('en-US', { weekday: 'long' }).toLowerCase();
}

// Converts "HH:mm:ss" IST string to UTC Date object for querying Mongo
function getISTDateTime(timeStr) {
  const [hh, mm, ss = '00'] = timeStr.split(':');
  const istNow = getISTDate();

  // Build ISO string like '2025-05-28T14:30:00+05:30'
  const dateStr = `${istNow.toISOString().split('T')[0]}T${hh.padStart(2, '0')}:${mm.padStart(2, '0')}:${ss.padStart(2, '0')}+05:30`;

  return new Date(dateStr);  // Automatically converts to UTC timestamp
}




module.exports = {
  getISTDate,
  getISTDateString,
  getISTTimeString,
  getISTDayName,
  getISTDateTime
};
