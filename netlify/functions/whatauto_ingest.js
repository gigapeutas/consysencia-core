const { createClient } = require("@supabase/supabase-js");
const { decide } = require("./_core/brain");

exports.handler = async (event) => {
  try{
    if(event.httpMethod!=="POST"){
      return {statusCode:405,body:""};
    }

    const auth = event.headers.authorization || event.headers.Authorization || "";
    if(!auth.toLowerCase().startsWith("bearer ")){
      return {statusCode:401,body:""};
    }

    const instance_key = auth.slice(7).trim();
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const payload = JSON.parse(event.body||"{}");
    if(!payload.message) return {statusCode:200,body:JSON.stringify({reply:""})};

    const r = await decide({supabase,instance_key,payload});
    return {
      statusCode:200,
      headers:{ "content-type":"application/json" },
      body:JSON.stringify({ reply:r.reply })
    };
  }catch(e){
    return {statusCode:500,body:""};
  }
};
