'use strict';
// Server-authoritative Teen Patti: bets, cards, result, and wallet changes live on the server.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function initTeenPattiServer({ app, userAuth, users, findUserByUserId, saveUsers, logTransaction, pushWalletUpdate, productionWallet, dataFolder }) {
  const chips = new Set([1000, 100000, 500000, 1000000, 5000000]);
  const historyFile = path.join(dataFolder, 'teen_patti_rounds.json');
  let history = [];
  try { history = JSON.parse(fs.readFileSync(historyFile, 'utf8')); if (!Array.isArray(history)) history = []; } catch (_) {}
  const leaderboard = new Map();
  const queues = new Map();
  let roundCounter = Math.max(0, ...history.map(x => Number(x.roundId) || 0));
  let round;
  let activeBets = 0;
  const suits = [{s:'♠',j:0,red:false},{s:'♥',j:1,red:true},{s:'♣',j:2,red:false},{s:'♦',j:3,red:true}];
  const ranks = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
  const suitRank = {'♠':4,'♥':3,'♣':2,'♦':1};
  const randomInt = n => crypto.randomInt(0, n);
  function deal() {
    const deck = [];
    for (let v=2; v<=14; v++) for (const s of suits) deck.push({r:ranks[v-2],v,s:s.s,j:s.j,red:s.red});
    for (let i=deck.length-1;i>0;i--) { const j=randomInt(i+1); [deck[i],deck[j]]=[deck[j],deck[i]]; }
    return { A:deck.slice(0,3), B:deck.slice(3,6), C:deck.slice(6,9) };
  }
  function evaluate(cards) {
    let c = [...cards].sort((a,b)=>b.v-a.v);
    const flush = c.every(x=>x.j===c[0].j);
    let low=false, seq=c[0].v-c[1].v===1 && c[1].v-c[2].v===1;
    if (!seq && c[0].v===14 && c[1].v===3 && c[2].v===2) { seq=true; low=true; c=[c[1],c[2],c[0]]; }
    let cat;
    if(c[0].v===c[1].v && c[1].v===c[2].v) cat=6;
    else if(seq&&flush) cat=5; else if(flush) cat=4; else if(seq) cat=3;
    else if(c[0].v===c[1].v || c[1].v===c[2].v) { cat=2; if(c[1].v===c[2].v)c=[c[1],c[2],c[0]]; }
    else cat=1;
    return {cat,key:c.map(x=>low&&x.v===14?1:x.v),suits:c.map(x=>suitRank[x.s]),name:({6:'Trail',5:'Straight Flush',4:'Flush',3:'Straight',2:'Pair',1:'High Card'})[cat]};
  }
  function compare(a,b) { if(a.cat!==b.cat)return a.cat-b.cat; for(const f of ['key','suits'])for(let i=0;i<3;i++){const d=a[f][i]-b[f][i];if(d)return d;} return 0; }
  function newRound() {
    round = { roundId: ++roundCounter, phase:'betting', startedAt:Date.now(), endsAt:Date.now()+20000, hands:deal(), bets:{}, pots:{A:0,B:0,C:0}, winner:null, handNames:{}, totalPaid:0 };
    setTimeout(closeRound, 20000).unref?.();
  }
  function persistHistory() {
    try { fs.mkdirSync(path.dirname(historyFile),{recursive:true}); const tmp=historyFile+'.tmp'; fs.writeFileSync(tmp,JSON.stringify(history.slice(-500),null,2)); fs.renameSync(tmp,historyFile); } catch(e) { console.error('[TeenPatti] history write failed:',e.message); }
  }
  function locateUser(req) {
    const direct = users[req.authedMobile];
    if (direct && direct.userId) return { user:direct, userId:direct.userId };
    const found = findUserByUserId(req.authedMobile);
    if (found && found.user && found.user.userId) return { user:found.user, userId:found.user.userId };
    const byMobile = Object.values(users).find(u => u && u.mobile === req.authedMobile);
    return byMobile && byMobile.userId ? {user:byMobile,userId:byMobile.userId} : null;
  }
  async function balanceFor(found) {
    if (productionWallet.enabled()) {
      const b = await productionWallet.balance(found.userId,'diamonds');
      if (Number.isFinite(Number(b))) found.user.diamonds = Math.max(0,Math.floor(Number(b)));
    }
    return Math.max(0,Math.floor(Number(found.user.diamonds)||0));
  }
  function hotSeats() {
    if (!round || !round.bets) return [];
    return Object.entries(round.bets).map(([userId, bets]) => {
      const found = findUserByUserId(userId);
      const user = found && found.user ? found.user : (users[userId] || Object.values(users).find(x => x && x.userId === userId));
      const bet = Object.values(bets || {}).reduce((sum, value) => sum + Math.max(0, Math.floor(Number(value) || 0)), 0);
      return {
        userId,
        name: String(user && (user.name || user.nickname || user.displayName) || userId).slice(0, 48),
        avatar: user && (user.avatar || user.avatarUrl || user.photoURL || user.profileImage || user.profilePic || user.profilePhoto || user.photo || user.image || user.picture) || null,
        bet
      };
    }).filter(x => x.bet > 0).sort((a, b) => b.bet - a.bet || a.userId.localeCompare(b.userId)).slice(0, 3);
  }
  function view(found) {
    const resultReady = round.phase === 'result';
    const meBets = round.bets[found.userId] || {A:0,B:0,C:0};
    const cards = {};
    for (const side of ['A','B','C']) cards[side] = resultReady ? round.hands[side].map(c=>({r:c.r,v:c.v,s:c.s,red:c.red})) : [];
    const board = [...leaderboard.values()].sort((a,b)=>b.played-a.played).slice(0,15);
    return { success:true, roundId:round.roundId, phase:round.phase, endsAt:round.endsAt, serverNow:Date.now(), pots:round.pots, myBets:meBets, balance:Math.max(0,Math.floor(Number(found.user.diamonds)||0)), cards, winner:resultReady?round.winner:null, handNames:resultReady?round.handNames:{}, history:history.slice(-50).reverse(), leaderboard:board, hotSeats:hotSeats(), totalPlayed:leaderboard.get(found.userId)?.played||0 };
  }
  async function closeRound() {
    if (!round || round.phase !== 'betting') return;
    if (activeBets > 0) { setTimeout(closeRound, 50).unref?.(); return; }
    round.phase='result'; round.endsAt=Date.now()+4000;
    const ev={}; for(const side of ['A','B','C'])ev[side]=evaluate(round.hands[side]);
    const winner=['A','B','C'].reduce((w,s)=>compare(ev[s],ev[w])>0?s:w,'A');
    round.winner=winner; round.handNames=Object.fromEntries(['A','B','C'].map(s=>[s,ev[s].name]));
    history.push({roundId:round.roundId,winner,handNames:round.handNames,endedAt:new Date().toISOString(),pots:{...round.pots}}); if(history.length>500)history=history.slice(-500); persistHistory();
    for(const [userId,bets] of Object.entries(round.bets)) {
      const amount=Math.floor(Number(bets[winner])||0); if(amount<=0)continue;
      const found=findUserByUserId(userId); if(!found||!found.user)continue;
      const payout=Math.floor(amount*2.9); if(payout<=0)continue;
      try {
        if(productionWallet.enabled()) {
          const wr=await productionWallet.credit(userId,'diamonds',payout,'Teen Patti win',`teen-patti:${round.roundId}`,`teen-patti-payout:${round.roundId}:${userId}`);
          if(!wr||wr.status==='rejected') throw new Error('wallet credit rejected');
          found.user.diamonds=Number(wr.balanceAfter);
        } else found.user.diamonds=Math.max(0,Math.floor(Number(found.user.diamonds)||0))+payout;
        round.totalPaid+=payout; saveUsers(); logTransaction(userId,'diamonds',payout,'Teen Patti win'); pushWalletUpdate(userId);
      } catch(e) { console.error(`[TeenPatti] payout failed round=${round.roundId} user=${userId}:`,e.message); }
    }
    setTimeout(newRound,4000).unref?.();
  }
  app.get('/api/teen-patti/state', userAuth.requireUserAuth, async (req,res)=>{
    const found=locateUser(req); if(!found)return res.status(404).json({success:false,message:'User not found'});
    await balanceFor(found); return res.json(view(found));
  });
  app.post('/api/teen-patti/bet', userAuth.requireUserAuth, async (req,res)=>{
    const found=locateUser(req); if(!found)return res.status(404).json({success:false,message:'User not found'});
    const side=String(req.body?.side||''); const amount=Math.floor(Number(req.body?.amount)||0);
    if(!['A','B','C'].includes(side)||!chips.has(amount))return res.status(400).json({success:false,message:'Invalid side or chip'});
    const prior=queues.get(found.userId)||Promise.resolve(); let release; const hold=new Promise(r=>release=r); const tail=prior.then(()=>hold); queues.set(found.userId,tail); await prior;
    let countedActiveBet=false;
    try {
      if(round.phase!=='betting'||Date.now()>=round.endsAt)return res.status(409).json({success:false,message:'Betting is closed',state:view(found)});
      activeBets++; countedActiveBet=true;
      const balance=await balanceFor(found); if(balance<amount)return res.status(409).json({success:false,message:'Insufficient Diamonds',state:view(found)});
      if(productionWallet.enabled()) {
        const wr=await productionWallet.debit(found.userId,'diamonds',amount,'Teen Patti bet',`teen-patti:${round.roundId}`,`teen-patti-bet:${round.roundId}:${found.userId}:${crypto.randomUUID()}`);
        if(!wr||wr.status==='rejected')return res.status(409).json({success:false,message:'Wallet debit rejected'});
        found.user.diamonds=Number(wr.balanceAfter);
      } else found.user.diamonds=balance-amount;
      if(!round.bets[found.userId])round.bets[found.userId]={A:0,B:0,C:0};
      round.bets[found.userId][side]+=amount; round.pots[side]+=amount;
      const lb=leaderboard.get(found.userId)||{userId:found.userId,name:found.user.name||'Player',played:0}; lb.played+=amount; leaderboard.set(found.userId,lb);
      saveUsers(); logTransaction(found.userId,'diamonds',-amount,'Teen Patti bet'); pushWalletUpdate(found.userId);
      return res.json(view(found));
    } catch(e) { console.error('[TeenPatti] bet failed:',e.message); return res.status(500).json({success:false,message:'Bet could not be processed'}); }
    finally { if(countedActiveBet)activeBets=Math.max(0,activeBets-1); release(); if(queues.get(found.userId)===tail)queues.delete(found.userId); }
  });
  newRound();
  console.log('🃏 Teen Patti server-authoritative game initialized (authenticated bets, server cards/results, wallet debit/payout).');
}
module.exports = { initTeenPattiServer };
