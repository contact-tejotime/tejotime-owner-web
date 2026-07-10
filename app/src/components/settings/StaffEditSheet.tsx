import React, { useState } from 'react';
import { View } from 'react-native';

import { TButton, TInput, TText } from '@/components/common';
import { EditSheet } from '@/components/settings/EditSheet';
import { Staff } from '@/data/sample';
import { styles } from '@/styles';

/** Add/edit bottom sheet for a staff member (name, role). */
export function StaffEditSheet({
  open,
  member,
  saving,
  onClose,
  onSave,
}: {
  open: boolean;
  member: Staff | null;
  saving: boolean;
  onClose: () => void;
  onSave: (f: { name: string; roleLabel: string }) => void;
}) {
  return (
    <EditSheet visible={open} title={member ? 'Edit staff member' : 'Add staff member'} onClose={onClose}>
      {open && <StaffForm key={member?.id ?? 'new'} member={member} saving={saving} onSave={onSave} />}
    </EditSheet>
  );
}

/** Remounted per open/member (via key) so field state seeds from props without effects. */
function StaffForm({
  member,
  saving,
  onSave,
}: {
  member: Staff | null;
  saving: boolean;
  onSave: (f: { name: string; roleLabel: string }) => void;
}) {
  const [name, setName] = useState(member?.name ?? '');
  const [role, setRole] = useState(member?.roleLabel ?? 'Stylist');
  const [error, setError] = useState('');

  const save = () => {
    if (!name.trim()) {
      setError('Enter a name.');
      return;
    }
    onSave({ name: name.trim(), roleLabel: role.trim() });
  };

  return (
    <View style={styles.g4}>
      <TInput
        label="Name"
        placeholder="Full name"
        value={name}
        onChangeText={(v) => {
          setName(v);
          setError('');
        }}
      />
      <TInput label="Role" placeholder="e.g. Stylist" value={role} onChangeText={setRole} />
      {!!error && (
        <TText variant="bodySm" color="error">
          {error}
        </TText>
      )}
      <TButton variant="primary" size="lg" fullWidth loading={saving} onPress={save}>
        Save
      </TButton>
    </View>
  );
}
