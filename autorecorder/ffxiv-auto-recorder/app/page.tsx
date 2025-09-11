import PlayerPane from "../components/PlayerPane";
import RecordList from "../components/RecordList";

export default function Page() {
  return (
    <main style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <section style={{ flex: 2, minHeight: 300, borderBottom: '1px solid #222' }}>
        <PlayerPane />
      </section>
      <section style={{ flex: 1, minHeight: 200, overflow: 'auto' }}>
        <RecordList />
      </section>
    </main>
  )
}
