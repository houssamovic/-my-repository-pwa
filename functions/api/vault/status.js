const respond = (body) => new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export async function onRequestGet({env}) {
  if (!env.REPOSITORY_DB) return respond({available:false});
  try {await env.REPOSITORY_DB.prepare('SELECT id FROM vaults LIMIT 1').first();return respond({available:true});}
  catch{return respond({available:false});}
}
export function onRequest(){return new Response('Method not allowed',{status:405});}
