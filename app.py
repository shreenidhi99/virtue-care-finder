"""Streamlit entry point for Virtue Care Finder.

Two modes:
- Find care: a plain chat with the team's Genie agent. Each question goes straight
  to the agent (location included in the text, e.g. "snakebite near Kallidaikurichi");
  follow-ups continue the same Genie conversation.
- District planner: NFHS-5 burden vs facility supply maps and charts (finder/planner.py).
"""
import streamlit as st

from finder import config, genie, planner, results

MODES = ["Find care", "District planner"]
ss = st.session_state
ss.setdefault("mode", MODES[0])
# The planner needs the full width; the chat reads better centred.
st.set_page_config(page_title="Virtue Care Finder", page_icon="🏥",
                   layout="wide" if ss.mode == MODES[1] else "centered")

if config.missing():
    st.error("Missing settings: " + ", ".join(config.missing()))
    st.stop()

ss.setdefault("chat", [])             # list of {"role", "content", "sql", "df", "error", "why"}
ss.setdefault("conversation_id", None)

st.title("🏥 Virtue Care Finder")
st.radio("Mode", MODES, key="mode", horizontal=True, label_visibility="collapsed")

if ss.mode == MODES[1]:
    planner.render()
    st.stop()

# ---------------- Find care: direct agent chat ----------------

WHY_QUESTION = ("WHY this facility? What evidence says this facility exists, offers this service, "
                "and is the best choice for this location?\nFacility: {name}")
NAME_COLUMNS = ("facility_name", "name", "facility")
EXAMPLES = ["Snakebite treatment near Kallidaikurichi, urgent",
            "Maternity hospital near PIN 627401",
            "Dialysis centres in Tirunelveli"]


def facility_names(df) -> list[str]:
    """Facility names from an agent result table, in the order the agent returned them."""
    if df is None or df.empty:
        return []
    col = next((c for c in NAME_COLUMNS if c in df.columns), None)
    if col is None:
        return []
    return list(dict.fromkeys(str(v) for v in df[col].dropna()))


def show_answer(m: dict, key: str) -> None:
    if m.get("error"):
        st.error(f"The assistant couldn't answer: {m['error']}")
    if m.get("content"):
        st.markdown(m["content"])
    results.render_table(m.get("df"), key)   # facility cards; no raw tables or SQL shown to users


def send(message: str) -> None:
    ss.chat.append({"role": "user", "content": message})
    with st.spinner("Asking the assistant… (can take up to a minute)"):
        ans = genie.ask(message, ss.conversation_id)
    if ans.conversation_id:
        ss.conversation_id = ans.conversation_id
    ss.chat.append({"role": "assistant", "content": ans.text, "sql": ans.sql,
                    "df": ans.df, "error": ans.error, "suggestions": getattr(ans, "suggestions", [])})


c1, c2 = st.columns([4, 1], vertical_alignment="center")
c1.caption("Ask for a service and a place (town, PIN code or “lat, lon”). "
           "Records only say a service is *mentioned*; always verify by phone.")
if c2.button("New chat", width="stretch"):
    ss.chat, ss.conversation_id = [], None
    st.rerun()

if not ss.chat:
    st.markdown("**Try:**")
    for i, ex in enumerate(EXAMPLES):
        if st.button(ex, key=f"ex-{i}"):
            send(ex)
            st.rerun()

for i, m in enumerate(ss.chat):
    with st.chat_message(m["role"]):
        show_answer(m, f"m{i}")
        names = facility_names(m.get("df")) if m["role"] == "assistant" else []
        if names:
            a, b = st.columns([4, 2], vertical_alignment="bottom")
            pick = a.selectbox("Facility", names, key=f"pick-{i}", label_visibility="collapsed")
            if b.button("Why this facility?", key=f"why-{i}", width="stretch"):
                ss.pending_why = (i, pick)
                st.rerun()
        # The agent's reasoning, shown below the answer it explains.
        for w in m.get("why", []):
            with st.container(border=True):
                st.markdown(f"**Why {w['name']}?**")
                show_answer(w, f"w{i}-{w['name']}")
        # Clarifying questions: the agent's reply is shown as-is, and the user's next message
        # (typed, or one of the agent's suggested options below) continues the same conversation.
        if m["role"] == "assistant" and i == len(ss.chat) - 1 and m.get("suggestions"):
            st.caption("Reply, or tap one:")
            for j, sug in enumerate(m["suggestions"]):
                if st.button(sug, key=f"sug-{i}-{j}"):
                    ss.pending_reply = sug
                    st.rerun()

if ss.get("pending_reply"):
    send(ss.pop("pending_reply"))
    st.rerun()

if ss.get("pending_why"):
    idx, name = ss.pop("pending_why")
    with st.spinner(f"Asking the assistant why {name}… (can take up to a minute)"):
        ans = genie.ask(WHY_QUESTION.format(name=name), ss.conversation_id)
    if ans.conversation_id:
        ss.conversation_id = ans.conversation_id
    ss.chat[idx].setdefault("why", []).append(
        {"name": name, "content": ans.text, "sql": ans.sql, "df": ans.df, "error": ans.error})
    st.rerun()

question = st.chat_input("What care is needed, and where?")
if question:
    send(question)
    st.rerun()
