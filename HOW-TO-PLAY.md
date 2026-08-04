# How to Play Cipherin Gin Rummy

## The Goal

Gin Rummy is a two-player card game played in a series of hands. Each
hand, you're racing to arrange your cards into **melds** (sets or runs)
while minimizing the value of the cards left over. Whoever accumulates
100 points first across all the hands wins the match.

## The Deal

Each hand, you and the computer are dealt 10 cards. One card is turned
face-up to start the **discard pile**; the rest form the **stock pile**,
face-down. Players alternate who deals — and who therefore goes first —
from hand to hand.

## Melds

A meld is either:

- **A set** — three or four cards of the same rank (e.g. 7♠ 7♥ 7♦)
- **A run** — three or more consecutive cards of the same suit
  (e.g. 4♣ 5♣ 6♣)

Any card not part of a meld is **deadwood**, and counts against you.
Deadwood is scored by rank: Ace = 1 point, 2 through 10 = face value,
Jack/Queen/King = 10 points each.

## Your Turn

On your turn you:

1. **Draw** one card — either the top of the stock pile (unseen) or the
   top of the discard pile (whatever the last person threw away).
2. **Discard** one card from your hand, face-up onto the discard pile.

If you drew from the discard pile, there's one restriction: you can't
immediately discard that exact same card back. You have to hold onto
it for at least this turn and discard something else instead. (Drawing
from the stock has no such restriction.)

That's it. Play passes back and forth until someone ends the hand.

## Ending a Hand

There are three ways a hand ends:

- **Knock** — If, after your discard, your remaining deadwood adds up
  to **10 points or less**, you may knock instead of just discarding.
  This reveals your hand and ends the round.
- **Gin** — If your discard leaves you with **zero deadwood** — every
  card is part of a meld — you go out with Gin, a stronger result than
  a knock.
- **Wash** — If the stock pile runs down without anyone knocking, the
  hand ends with no score for either side.

## Scoring a Hand

**If you knock:** your opponent gets to "lay off" any deadwood cards of
theirs that extend your melds (add a matching card to one of your sets,
or extend one of your runs) before the score is tallied. Whoever has
less deadwood after layoffs wins the hand and scores the *difference*
between the two deadwood totals.

- If your opponent's deadwood, after laying off, is actually **equal to
  or lower than yours**, they've **undercut** you — they win the hand
  instead and get a **25-point bonus** on top of the difference.

**If you go Gin:** your opponent cannot lay off any cards. You score
your opponent's full deadwood total, plus a **25-point bonus**.

## Winning the Match

Play continues, hand after hand, until someone's running score reaches
**100 points**. At that point, a scorecard totals up the whole match:

| Bonus | How it's earned |
|---|---|
| **Game Bonus** | 100 points, awarded to whoever won the match |
| **Line Bonus** | 25 points for every hand you won |
| **Shutout Bonus** | If your opponent never won a single hand all match, your final score doubles |

All of that gets summed into a **Grand Total** shown on the final
scorecard. (For the full breakdown with a worked example, see the
"How the end-of-match scorecard is calculated" section of `README.md`.)

## Playing on This App

- **Draw:** click the stock pile or the discard pile.
- **Discard:** click a card in your hand to select it, then press the
  **Space bar**, tap the **Discard** button (for phones and tablets),
  **or** drag it onto the discard pile.
- **Knock:** click a card once to select it, then click the **Knock**
  button (only enabled when that discard would leave you at 10
  deadwood or less).
- **Sort your hand:** use **Sort by Suit**, **Sort by Value**, or drag
  cards into your own order under **Manual Order**.
- **Melds are grouped and labeled automatically** in Sort by Suit/Value
  so you can see your deadwood at a glance.
- **If a discard would break up an already-formed meld**, the app
  warns you before letting it happen.
- **Players:** click **Players** to create up to 10 computer opponents,
  each with their own name, playing style (Aggressive Knocker, Patient
  Gin Seeker, or Defensive Trapper), and skill level (Intermediate,
  Advanced, Expert). Advanced and Expert opponents also learn from how
  you play against them over time, not just within one hand, so they
  get sharper the more you play a given opponent. Your match record
  and detailed stats against each one are saved to your account —
  click **Stats** next to any player to see them, including a note on
  what the computer's picked up on so far.

## A Few Tips

- Low cards (Aces, 2s, 3s) are cheap to hold as deadwood, so they're
  safer to keep around while you wait for a meld to come together.
- High cards (face cards, 10s) hurt the most if you're stuck holding
  them — get rid of ones that aren't working out early.
- Watch what your opponent picks up from the discard pile — it tells
  you what they need, so avoid discarding anything close to it.
- Knocking early is safer but caps your upside; going for Gin risks
  more but pays a real bonus and denies your opponent any layoffs.
