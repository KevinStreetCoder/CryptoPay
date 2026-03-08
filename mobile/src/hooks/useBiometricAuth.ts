import { useCallback, useEffect, useState } from "react";
import * as LocalAuthentication from "expo-local-authentication";

interface BiometricAuthState {
  isAvailable: boolean;
  biometricType: "fingerprint" | "face" | "iris" | "none";
  isEnrolled: boolean;
}

interface UseBiometricAuthReturn extends BiometricAuthState {
  authenticate: (promptMessage?: string) => Promise<boolean>;
  loading: boolean;
}

export function useBiometricAuth(): UseBiometricAuthReturn {
  const [state, setState] = useState<BiometricAuthState>({
    isAvailable: false,
    biometricType: "none",
    isEnrolled: false,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const checkBiometrics = async () => {
      try {
        const compatible = await LocalAuthentication.hasHardwareAsync();
        const enrolled = await LocalAuthentication.isEnrolledAsync();
        const types =
          await LocalAuthentication.supportedAuthenticationTypesAsync();

        let biometricType: BiometricAuthState["biometricType"] = "none";
        if (
          types.includes(
            LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION
          )
        ) {
          biometricType = "face";
        } else if (
          types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)
        ) {
          biometricType = "fingerprint";
        } else if (
          types.includes(LocalAuthentication.AuthenticationType.IRIS)
        ) {
          biometricType = "iris";
        }

        if (mounted) {
          setState({
            isAvailable: compatible && enrolled,
            biometricType,
            isEnrolled: enrolled,
          });
        }
      } catch {
        // Biometrics not supported on this device
      } finally {
        if (mounted) setLoading(false);
      }
    };

    checkBiometrics();
    return () => {
      mounted = false;
    };
  }, []);

  const authenticate = useCallback(
    async (
      promptMessage = "Authenticate to continue"
    ): Promise<boolean> => {
      if (!state.isAvailable) return false;

      try {
        const result = await LocalAuthentication.authenticateAsync({
          promptMessage,
          cancelLabel: "Use PIN",
          disableDeviceFallback: false,
          fallbackLabel: "Enter PIN",
        });

        return result.success;
      } catch {
        return false;
      }
    },
    [state.isAvailable]
  );

  return {
    ...state,
    authenticate,
    loading,
  };
}
