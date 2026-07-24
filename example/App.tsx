import * as MicrophoneStream from '@scribemd-ai/mobile-sdk';
import { useEffect, useState } from 'react';
import { Button, SafeAreaView, ScrollView, Text, View } from 'react-native';

export default function App() {
  const [streaming, setStreaming] = useState(false);
  const [level, setLevel] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);

  useEffect(() => {
    const stateSub = MicrophoneStream.addStreamStateChangeListener((event) => {
      setStreaming(event.state === 'streaming');
    });
    const levelSub = MicrophoneStream.addAudioLevelListener((event) => {
      setLevel(event.level);
    });
    const errorSub = MicrophoneStream.addErrorListener((event) => {
      setLastError(event.error);
    });
    return () => {
      stateSub.remove();
      levelSub.remove();
      errorSub.remove();
    };
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.container}>
        <Text style={styles.header}>ScribeMD Microphone Stream</Text>
        <Group name="Streaming">
          <Text>State: {streaming ? 'streaming' : 'stopped'}</Text>
          <Text>Level: {level.toFixed(3)}</Text>
          <Button
            title="Start streaming"
            onPress={() => MicrophoneStream.startStreaming({ sampleRate: 16000, channels: 1 })}
          />
          <Button title="Stop streaming" onPress={() => MicrophoneStream.stopStreaming()} />
        </Group>
        <Group name="Inputs">
          <Text>{JSON.stringify(MicrophoneStream.getCurrentInput())}</Text>
        </Group>
        {lastError ? (
          <Group name="Last error">
            <Text>{lastError}</Text>
          </Group>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Group(props: { name: string; children: React.ReactNode }) {
  return (
    <View style={styles.group}>
      <Text style={styles.groupHeader}>{props.name}</Text>
      {props.children}
    </View>
  );
}

const styles = {
  header: { fontSize: 30, margin: 20 },
  groupHeader: { fontSize: 20, marginBottom: 20 },
  group: { margin: 20, backgroundColor: '#fff', borderRadius: 10, padding: 20 },
  container: { flex: 1, backgroundColor: '#eee' },
};
