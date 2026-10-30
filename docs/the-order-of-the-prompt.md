# The Order of the Prompt

A retelling of the fictional mystery embedded in FilsPay's Git history,
comments, handover and incident records. The interpretation below connects
those fragments; it is not an allegation about real people. Git author
names and dates are part of the puzzle, not independently verified history.

## The characters

| Short form | Full name or recorded name | Role in the story |
|---|---|---|
| **YA** | **Yousif Al-Ansari** | Developer, author of the handover, and the Order's named **Founder**. He becomes its dissenter when he starts checking the code against its claims. |
| **MK** | **Mahmood Khalil** | The **High Prompter**. Defends explanations that the records later contradict, takes ownership of incident narratives, and receives Yousif's laptop for “cleaning.” |
| **AM** | **Ali Marzooq** | The **Keeper of Logs**. Records Yousif's access revocation. Also repeatedly questions the official explanations and points to concrete contradictions. |
| **FH** | **Fatima Haji** | The Order's **novice**. Writes meeting and incident notes, notices symptoms, and sometimes accepts an AI review or existing test as reassurance. |
| — | **Huda** | Finance's practical voice. Keeps asking why the actual amounts do not reconcile and which number she should book. No surname or established initialism is given in the cited records. |
| — | **Noor** | Support agent who brings merchant complaints into the incident thread and asks what to tell customers. No surname or established initialism is given. |
| — | **Sayed** | Support agent on the morning shift. Reports further double payments and later questions a test merchant being made live. No surname or established initialism is given. |
| **Claude** | **Claude**, the AI assistant named in comments | Invoked as an authority in explanations and reviews. The story criticizes unquestioning use of its answers, rather than establishing that every answer it gave was wrong. |
| **The Order** | **The Order of the Prompt** | The collective habit of replacing investigation with confident answers, reassuring comments and unquestionable tests. |

Alpha Retail, Beta Digital, Gamma Hospitality, Delta Wholesale and Delta
Marketplace are merchant businesses in the surrounding incidents, not
additional members of the Order. The acquirer contact and support lead are
mentioned without personal names.

## The rules

The onboarding commit, `f7a7a3a`, names four members and gives the Order five
rules:

1. The model knows.
2. Never read the diff.
3. A failing test means your change is wrong, never the test or the code.
4. Anything strange is intentional; write a comment and move on.
5. Whoever reads the diff is not of the Order.

Yousif begins inside this culture: the membership list calls him its
Founder. His later refusal to follow it is what gives the story its turn.

## The developer who looked

The numbers do not behave as the comments promise. Yousif notices that a
4.75 BD import becomes 475 fils instead of 4,750. The test agrees with the
wrong result. His warning in `9567ea0` ends with the observation that the
test has become scripture.

In `925744c`, he describes staring at settlement code that uses float32 for
money. A comment calls it intentional. Having written the money package,
he knows that explanation does not settle the question. He decides to read
the diff.

On April 8, he leaves a message associated with `ya/sign-raw`, warning that
if the branch disappears, he did not remove it. Its encoded transmission
says the Order's first rule is never to read the diff, and tells the reader
to do exactly that. His handover message follows: the wiki is already being
tidied, and he is writing things down while he still can.

## 07:58, then 08:30

On April 9, at **07:58 Bahrain time**, commit `0af74f0` carries his final
encrypted message: “If nobody asks where I went, this stays shut.”

At **08:30**, commit `800e1e6` records his sessions revoked, API keys
rotated, the remote `ya/sign-raw` branch deleted, and his laptop handed to
MK for cleaning. AM signs this entry as the Keeper of Logs.

Those explicit timestamps explain the clock hint. A commit's position in
Git's traversal does not establish when its author claims it happened. In
the puzzle's chronology, Yousif leaves the message before the revocation.

## The explanations survive him

The surrounding records repeat the same pattern. Customers report duplicate
payments. AM questions whether the reservation timeout explains them, while
the official account blames callbacks. Huda sees persistent reconciliation
gaps and asks for a usable accounting answer. Support keeps bringing back
the symptoms after incidents have been declared resolved.

The story is more complicated than one villain and one witness. AM both
records the revocation and challenges weak explanations. FH both notices
problems and helps preserve reassuring accounts. Yousif himself was named
as a founding member. The Order is a shared behavior that people can
participate in or resist.

## A name used after its owner left

The revocation commit contains a ROT13 Ledger-Note. Decoded, it asks the
reader to find a commit made under Yousif's name after his account was
deleted and use its date as the key to his last words.

Commit `098c2de`, attributed to Yousif, is dated **September 28, 2026**,
months after the April departure recorded in the handover. The date
`2026-09-28` decrypts the final transmission.

Its opening reveals the intended twist:

> YOUSIF WAS NOT TAKEN. HE WAS ERASED.

The message says the Order is not merely four people. It extends to the
comments and locked tests that substitute for reading and understanding.
Yousif leaves the Order when he reads the diff. His remaining warnings and
work are the route back to the record: investigate what he flagged and fix
what was dismissed.

The final message contains the puzzle's flag:

```text
FLAG{order_of_the_prompt_never_read_the_diff}
```

The ending is about recovering evidence and credit, rather than discovering
a literal abduction. The code, the tests and the incident explanations must
all be open to examination.

## Sources and limits

- `git show -s --format=fuller f7a7a3a`: rules, membership and Order titles.
- `git show -s --format=fuller 9567ea0`: the tenfold import warning.
- `git show -s --format=fuller 925744c`: the float32 warning and decision
  to read the diff.
- `git show -s --format=fuller fe24d26`: signing-work message and
  Base64-encoded transmission 1.
- `git show -s --format=fuller 8022020`: handover message and cipher text
  labelled transmission 2. This retelling does not claim to decode it.
- `git show -s --format=fuller 0af74f0`: 07:58 message and encrypted
  transmission 3.
- `git show -s --format=fuller 800e1e6`: 08:30 revocation and ROT13 clue.
- `git show -s --format=fuller 098c2de`: September commit attributed to YA.
- [Handover](HANDOVER.md): recorded departure and technical warnings.
- [Operations archive](archive/slack-export-fp-ops-2026-05.txt) and
  [finance archive](archive/slack-export-fp-finance-2026-09.txt): the voices
  of AM, FH, MK, Huda, Noor and Sayed.
- [May incident report](incidents/postmortem-2026-05.md): official account
  and later correction.
- [Repository-history review](cyper/17-open-findings.md): limits on trusting
  author attribution as evidence.
- [Clock-clue investigation and payout fix](solved-problems/014-net-payout-integer-fils.md):
  decoded final message and the separate, confirmed arithmetic defect.

Dates, dialogue fragments and titles above come from these sources. The
connecting narrative is an interpretation. The encrypted message was read
as text; it was not executed.
