import ctypes,subprocess
lib=ctypes.CDLL('libX11.so.6')
lib.XOpenDisplay.argtypes=[ctypes.c_char_p];lib.XOpenDisplay.restype=ctypes.c_void_p
lib.XInternAtom.argtypes=[ctypes.c_void_p,ctypes.c_char_p,ctypes.c_int];lib.XInternAtom.restype=ctypes.c_ulong
class Data(ctypes.Union):_fields_=[('b',ctypes.c_char*20),('s',ctypes.c_short*10),('l',ctypes.c_long*5)]
class Client(ctypes.Structure):_fields_=[('type',ctypes.c_int),('serial',ctypes.c_ulong),('send_event',ctypes.c_int),('display',ctypes.c_void_p),('window',ctypes.c_ulong),('message_type',ctypes.c_ulong),('format',ctypes.c_int),('data',Data)]
class Event(ctypes.Union):_fields_=[('client',Client),('pad',ctypes.c_long*24)]
display=lib.XOpenDisplay(None);assert display
window=int(subprocess.check_output(['xdotool','search','--name','PC Workbench.*WebviewJS']).decode().splitlines()[0])
event=Event();event.client.type=33;event.client.send_event=1;event.client.display=display;event.client.window=window;event.client.message_type=lib.XInternAtom(display,b'WM_PROTOCOLS',0);event.client.format=32;event.client.data.l[0]=lib.XInternAtom(display,b'WM_DELETE_WINDOW',0)
lib.XSendEvent.argtypes=[ctypes.c_void_p,ctypes.c_ulong,ctypes.c_int,ctypes.c_long,ctypes.POINTER(Event)];assert lib.XSendEvent(display,window,0,0,ctypes.byref(event))
lib.XFlush.argtypes=[ctypes.c_void_p];lib.XFlush(display)
