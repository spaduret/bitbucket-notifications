// runtime.js polyfills.js vendor.js main.js

// importScripts('./runtime.js');
// importScripts('./polyfills.js');
// importScripts('./vendor.js');
// importScripts('./main.js');

self.addEventListener('message', function(event) {
  console.log(event);
  if(event.data.type === 'settings-saved') {
  }
});
