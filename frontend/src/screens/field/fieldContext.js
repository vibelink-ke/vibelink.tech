import { createContext, useContext } from 'react';

/** Shared by the field app's screens: who is signed in, the shift, where the phone is. */
export const FieldContext = createContext(null);
export const useField = () => useContext(FieldContext);
