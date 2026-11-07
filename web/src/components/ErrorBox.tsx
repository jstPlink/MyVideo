export default function ErrorBox({ message }: { message: string }) {
  return (
    <div className="page-msg">
      <p>{message}</p>
      <button className="btn secondary" onClick={() => window.location.reload()}>Riprova</button>
    </div>
  );
}
