// exports.exchangeCode = async (code) => {
//   const tokenRes = await axios.post(
//     "https://discord.com/api/oauth2/token",
//     new URLSearchParams({
//       client_id: process.env.CLIENT_ID,
//       client_secret: process.env.CLIENT_SECRET,
//       grant_type: "authorization_code",
//       code,
//       redirect_uri: process.env.REDIRECT_URI,
//     }),
//     { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
//   );

//   const { access_token, refresh_token } = tokenRes.data;

//   const userRes = await axios.get("https://discord.com/api/users/@me", {
//     headers: { Authorization: `Bearer ${access_token}` },
//   });

//   return {
//     ...userRes.data,
//     access_token,
//     refresh_token,
//   };
// };
