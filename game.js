function startRound(){
  state.deck = shuffle(makeDeck());
  state.playerHand = [];
  state.computerHand = [];
  state.selectedIndex = null;
  state.locked = false;
  state.humanPickupLog = [];
  if (!state.publicHistory) state.publicHistory = defaultPublicHistory();
  state.humanHandStats = { draws: 0, stockDraws: 0, discards: 0, highCardDiscards: 0, lowCardPassOpportunities: 0, lowCardPasses: 0 };
  state.handStartTime = Date.now();
  state.playerJustDrawnFromDiscardId = null;
  state.computerJustDrawnFromDiscardId = null;
  state.computerTurnsThisHand = 0;

  if (state.opponent && state.opponent.id){
    state.opponent.stats.handsStarted += 1;
    saveProfiles(state.profiles);
  }

  for (let i = 0; i < 10; i++){
    state.playerHand.push(state.deck.pop());
    state.computerHand.push(state.deck.pop());
  }
  state.discard = [state.deck.pop()];
  state.stock = state.deck;
  state.manualOrder = state.playerHand.map(c => c.id);

  clearLog();
  log(`Hand ${state.round} dealt. ${state.dealerIsPlayer ? oppName() : "You"} act first.`, "intro");

  state.turn = state.dealerIsPlayer ? "computer" : "player";
  state.phase = "draw";

  renderAll();

  if (state.turn === "computer"){
    state.locked = true;
    setTimeout(computerTurn, 300); // reduced from 700ms
  }
}

function performDiscard(i, asKnock){
  const card = state.playerHand[i];
  const remaining = state.playerHand.filter((_, idx) => idx !== i);
  const a = analyzeHand(remaining);

  if (asKnock && a.deadwoodPoints > 10){
    log("That discard leaves too much deadwood to knock.", "important");
    state.selectedIndex = null;
    renderAll();
    return;
  }

  state.playerHand = remaining;
  state.discard.push(card);
  state.selectedIndex = null;
  state.humanHandStats.discards += 1;
  if (cardPoints(card.r) >= 10) state.humanHandStats.highCardDiscards += 1;
  if (!state.publicHistory) state.publicHistory = defaultPublicHistory();
  state.publicHistory.playerDiscards.push(card);
  state.humanPickupLog = state.humanPickupLog.filter(c => c.id !== card.id);
  log(`You discarded ${cardLabel(card)}.`, "you");

  if (a.deadwoodPoints === 0){
    renderAll();
    endRound({ type: "gin", knocker: "player" });
    return;
  }

  if (asKnock){
    renderAll();
    endRound({ type: "knock", knocker: "player" });
    return;
  }

  renderAll();

  if (state.stock.length <= 2){
    endRound({ type: "wash" });
    return;
  }

  state.turn = "computer";
  state.phase = "draw";
  state.locked = true;
  renderAll();
  setTimeout(computerTurn, 300); // reduced from 700ms
}

function computerTurn(){
  const persona = state.opponent;
  state.computerTurnsThisHand += 1;
  const draw = computerChooseDraw(persona);
  let drawnCard;
  if (draw === "discard" && state.discard.length > 0){
    drawnCard = state.discard.pop();
    state.computerHand.push(drawnCard);
    state.computerJustDrawnFromDiscardId = drawnCard.id;
    log(`${oppName()} drew ${cardLabel(drawnCard)} from the discard pile.`, "comp");
  } else {
    drawnCard = state.stock.pop();
    state.computerHand.push(drawnCard);
    state.computerJustDrawnFromDiscardId = null;
    log(`${oppName()} drew from the stock.`, "comp");
  }
  renderAll();

  setTimeout(() => {
    const hand = state.computerHand;
    let options = bestDiscardOptions(hand);
    if (state.computerJustDrawnFromDiscardId !== null){
      const legal = options.filter(o => hand[o.discardIndex].id !== state.computerJustDrawnFromDiscardId);
      if (legal.length) options = legal;
    }
    const best = options[0];

    if (best.deadwood === 0){
      const card = hand[best.discardIndex];
      state.computerHand = best.remaining;
      state.discard.push(card);
      log(`${oppName()} discards ${cardLabel(card)} and declares Gin!`, "comp important");
      renderAll();
      endRound({ type: "gin", knocker: "computer" });
      return;
    }

    const effectiveStyle = personaEffectiveStyle(persona);
    const threshold = knockThreshold(effectiveStyle, persona);
    const stockLow = state.stock.length <= 6;
    let canKnockNow = best.deadwood <= 10 && (best.deadwood <= threshold || stockLow);

    let knockChosen = null;
    if (canKnockNow){
      const knockCandidates = options.filter(o => o.deadwood === best.deadwood);
      knockChosen = pickWithDangerAwareness(knockCandidates, persona, hand);

      if (persona.skill === "expert" && !stockLow){
        const exposure = meldLayoffExposure(knockChosen.remaining, knockChosen.analysis.meldMasks);
        if (exposure >= 2 && knockChosen.deadwood > KNOCK_THRESHOLD_FLOOR){
          canKnockNow = false;
        }
      }
    }

    if (canKnockNow){
      const card = hand[knockChosen.discardIndex];
      state.computerHand = knockChosen.remaining;
      state.discard.push(card);
      log(`${oppName()} discards ${cardLabel(card)} and knocks with ${knockChosen.deadwood} deadwood.`, "comp important");
      renderAll();
      endRound({ type: "knock", knocker: "computer" });
      return;
    }

    const chosen = persona.skill === "expert"
      ? pickBuildingDiscard(expertDiscardWindow(options), persona, hand)
      : pickWithDangerAwareness(options.filter(o => o.deadwood <= best.deadwood + 1), persona, hand);
    const card = hand[chosen.discardIndex];
    state.computerHand = chosen.remaining;
    state.discard.push(card);
    log(`${oppName()} discards ${cardLabel(card)}.`, "comp");
    renderAll();

    if (state.stock.length <= 2){
      endRound({ type: "wash" });
      return;
    }

    state.turn = "player";
    state.phase = "draw";
    state.locked = false;
    renderAll();
  }, 250); // reduced from 650ms
}