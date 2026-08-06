import requests
import sys
import os
import math
import threading
import time

try:
    from pydub import AudioSegment
except ImportError:
    print("错误: 缺少 pydub 库。请先运行: pip3 install pydub")
    sys.exit(1)

class ASRClient:
    #  60000（即 60 秒 = 1 分钟）
    def __init__(self, api_url, api_key, chunk_duration_ms=120000):
        """
        初始化 ASR 客户端
        """
        self.api_url = api_url
        self.headers = {"Authorization": f"Bearer {api_key}"}
        self.chunk_duration_ms = chunk_duration_ms
        self.model_name = 'paraformer-large'

    def _waiting_animation(self, stop_event, current_chunk, total_chunks):
        dots = ["", ".", "..", "..."]
        i = 0
        while not stop_event.is_set():
            sys.stdout.write(f"\r⏳ 正在处理片段 {current_chunk}/{total_chunks} {dots[i%4]}    ")
            sys.stdout.flush()
            i += 1
            time.sleep(0.5)
        sys.stdout.write(f"\r{' ' * 50}\r")
        sys.stdout.flush()

    def process(self, audio_path, mode="pseudo", diarization=False):
        if not os.path.exists(audio_path):
            print(f"❌ 文件错误: 找不到音频文件 {audio_path}")
            return

        print(f"🚀 初始化 ASR 任务...")
        print(f"📁 文件: {audio_path}")
        print(f"⚙️ 模式: {'真流式 (WebSocket)' if mode == 'true' else '伪流式 (HTTP切片)'}")
        print(f"👥 区分说话人: {'开启' if diarization else '关闭'}")
        print(f"⏱️ 切片长度: {self.chunk_duration_ms / 1000} 秒") # 顺便加个打印提示
        print("-" * 50)

        if mode == "pseudo" and not diarization:
            self._pseudo_stream_no_diarize(audio_path)
        elif mode == "pseudo" and diarization:
            self._pseudo_stream_with_diarize(audio_path)
        elif mode == "true" and not diarization:
            self._true_stream_no_diarize(audio_path)
        elif mode == "true" and diarization:
            self._true_stream_with_diarize(audio_path)
        else:
            print("❌ 未知的模式或参数组合")

    def _pseudo_stream_no_diarize(self, audio_path):
        try:
            audio = AudioSegment.from_file(audio_path)
        except Exception as e:
            print(f"音频加载失败，请确认系统已安装 ffmpeg！错误详情: {e}")
            return

        total_length_ms = len(audio)
        total_chunks = math.ceil(total_length_ms / self.chunk_duration_ms)
        
        for i in range(total_chunks):
            start_ms = i * self.chunk_duration_ms
            end_ms = min((i + 1) * self.chunk_duration_ms, total_length_ms)
            
            chunk = audio[start_ms:end_ms]
            temp_file = f"/tmp/asr_chunk_{i}.wav"
            chunk.export(temp_file, format="wav")
            
            stop_event = threading.Event()
            anim_thread = threading.Thread(target=self._waiting_animation, args=(stop_event, i+1, total_chunks))
            anim_thread.start()
            
            try:
                with open(temp_file, 'rb') as f:
                    files = {'file': f}
                    data = {'model': self.model_name, 'response_format': 'verbose_json'} 
                    
                    response = requests.post(self.api_url, headers=self.headers, files=files, data=data)
                    
                    stop_event.set()
                    anim_thread.join()
                    
                    if response.status_code == 200:
                        segments = response.json().get('segments', [])
                        if not segments:
                            print(f"[片段 {i+1}] {response.json().get('text', '')}", flush=True)
                        else:
                            for seg in segments:
                                global_start_s = seg.get('start', 0) + (start_ms / 1000)
                                text = seg.get('text', '').strip()
                                if text:
                                    m, s = divmod(int(global_start_s), 60)
                                    h, m = divmod(m, 60)
                                    time_str = f"[{h:02d}:{m:02d}:{s:02d}]" if h > 0 else f"[{m:02d}:{s:02d}]"
                                    print(f"{time_str} {text}", flush=True)
                    else:
                        print(f"⚠️ 片段 {i+1} 失败: HTTP {response.status_code}", flush=True)
                        
            except Exception as e:
                stop_event.set()
                anim_thread.join()
                print(f"⚠️ 片段 {i+1} 发生异常: {str(e)}", flush=True)
            finally:
                if os.path.exists(temp_file):
                    os.remove(temp_file)

        print("-" * 50)
        print("🎉 全部转录完成！")

    def _pseudo_stream_with_diarize(self, audio_path):
        print("【建设中】正在开发：伪流式 + 区分说话人...")

    def _true_stream_no_diarize(self, audio_path):
        print("【建设中】正在开发：真流式 (WebSocket) + 无说话人...")

    def _true_stream_with_diarize(self, audio_path):
        print("【建设中】正在开发：真流式 (WebSocket) + 区分说话人...")

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("用法: python transcribe.py <音频文件路径>")
        sys.exit(1)
        
    audio_file = sys.argv[1]
    
    # 在这里显式传入 120000，确保万无一失
    client = ASRClient(
        api_url='http://192.168.1.13:18888/v1/audio/transcriptions',
        api_key='SII#gemr#2026!!',
        chunk_duration_ms=120000 
    )
    
    client.process(audio_file, mode="pseudo", diarization=False)