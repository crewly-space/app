import { useId, useState } from 'react';
import { Eye, EyeOff, Check } from 'lucide-react';

export function PasswordField({ value, onChange, creating = false, disabled = false, id: suppliedId }: {
  value: string; onChange: (value: string) => void; creating?: boolean; disabled?: boolean; id?: string;
}) {
  const generatedId = useId();
  const id = suppliedId ?? generatedId;
  const [visible, setVisible] = useState(false);
  return <div className="auth-password-control">
    <label htmlFor={id}>Password</label>
    <div className="auth-password-well">
      <input id={id} type={visible ? 'text' : 'password'} required minLength={creating ? 12 : 1}
        autoComplete={creating ? 'new-password' : 'current-password'} disabled={disabled}
        aria-describedby={creating ? `${id}-help` : undefined} value={value}
        placeholder={creating ? 'Create a password' : 'Enter your password'} onChange={(event) => onChange(event.target.value)} />
      <button type="button" disabled={disabled} aria-label={visible ? 'Hide password' : 'Show password'} aria-pressed={visible}
        onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={18} /> : <Eye size={18} />}</button>
    </div>
    {creating && <small id={`${id}-help`} className={value.length >= 12 ? 'password-ready' : ''}>
      {value.length >= 12 && <Check size={14} aria-hidden="true" />} Use at least 12 characters. A few memorable words work well.
    </small>}
  </div>;
}
