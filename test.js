fetch('http://localhost:5000/api/rag-search', {
  method: 'POST', 
  headers: {'Content-Type': 'application/json'}, 
  body: JSON.stringify({query: 'hello', emails: [{id: '1', from: 'test', subject: 'test', preview: 'test'}]})
}).then(async r => {
  console.log("STATUS:", r.status);
  console.log("BODY:", await r.text());
}).catch(console.error);
