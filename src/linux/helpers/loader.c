#include "inject-context.h"

#include "syscall.c"

#include <stdbool.h>
#include <unistd.h>

typedef int FridaUnloadPolicy;
typedef struct _FridaLinuxInjectorState FridaLinuxInjectorState;
typedef union _FridaControlMessage FridaControlMessage;

enum _FridaUnloadPolicy
{
  FRIDA_UNLOAD_POLICY_IMMEDIATE,
  FRIDA_UNLOAD_POLICY_RESIDENT,
  FRIDA_UNLOAD_POLICY_DEFERRED,
};

struct _FridaLinuxInjectorState
{
  int frida_ctrlfd;
  int agent_ctrlfd;
};

union _FridaControlMessage
{
  struct cmsghdr header;
  uint8_t storage[CMSG_SPACE (sizeof (int))];
};

static void * frida_main (void * user_data);
static int frida_receive_fd (int sockfd, FridaLibcApi * libc);

static pid_t frida_gettid (void);

bool
frida_load (FridaLoaderContext * ctx)
{
  ctx->libc->pthread_create (&ctx->worker, NULL, frida_main, ctx);

  return true;
}

static void *
frida_main (void * user_data)
{
  FridaLoaderContext * ctx = user_data;
  FridaLibcApi * libc = ctx->libc;
  FridaUnloadPolicy unload_policy;
  int ctrlfd_for_peer, ctrlfd, agent_codefd, agent_ctrlfd;
  char agent_path_storage[32];
  const char * agent_path;
  void * agent_handle = NULL;
  void (* agent_entrypoint) (const char * agent_parameters, FridaUnloadPolicy * unload_policy, void * injector_state);
  FridaLinuxInjectorState injector_state;

  unload_policy = FRIDA_UNLOAD_POLICY_IMMEDIATE;

  ctrlfd_for_peer = ctx->ctrlfds[0];
  if (ctrlfd_for_peer != -1)
    libc->close (ctrlfd_for_peer);

  ctrlfd = ctx->ctrlfds[1];
  if (ctrlfd != -1)
  {
    agent_codefd = frida_receive_fd (ctrlfd, libc);
    agent_ctrlfd = frida_receive_fd (ctrlfd, libc);

    libc->sprintf (agent_path_storage, "/proc/self/fd/%d", agent_codefd);
    agent_path = agent_path_storage;
  }
  else
  {
    agent_codefd = -1;
    agent_ctrlfd = -1;

    agent_path = ctx->agent_path;
  }

  agent_handle = libc->dlopen (agent_path, RTLD_GLOBAL | RTLD_LAZY);

  if (agent_codefd != -1)
    libc->close (agent_codefd);

  if (agent_handle == NULL)
    goto beach;

  agent_entrypoint = libc->dlsym (agent_handle, ctx->agent_entrypoint);
  if (agent_entrypoint == NULL)
    goto beach;

  injector_state.frida_ctrlfd = ctrlfd;
  injector_state.agent_ctrlfd = agent_ctrlfd;

  agent_entrypoint (ctx->agent_parameters, &unload_policy, &injector_state);

  ctrlfd = injector_state.frida_ctrlfd;
  agent_ctrlfd = injector_state.agent_ctrlfd;

beach:
  if (unload_policy == FRIDA_UNLOAD_POLICY_IMMEDIATE && agent_handle != NULL)
    libc->dlclose (agent_handle);

  if (unload_policy != FRIDA_UNLOAD_POLICY_DEFERRED)
    libc->pthread_detach (ctx->worker);

  if (agent_ctrlfd != -1)
    libc->close (agent_ctrlfd);

  if (ctrlfd != -1)
  {
    FridaByeMessage bye = {
      .unload_policy = unload_policy,
      .thread_id = frida_gettid (),
    };
    libc->send (ctrlfd, &bye, sizeof (bye), MSG_NOSIGNAL);
    libc->close (ctrlfd);
  }

  return NULL;
}

static int
frida_receive_fd (int sockfd, FridaLibcApi * libc)
{
  int res;
  uint8_t dummy;
  struct iovec io = {
    .iov_base = &dummy,
    .iov_len = sizeof (dummy)
  };
  FridaControlMessage control;
  struct msghdr msg = {
    .msg_name = NULL,
    .msg_namelen = 0,
    .msg_iov = &io,
    .msg_iovlen = 1,
    .msg_control = &control,
    .msg_controllen = sizeof (control),
  };

  res = libc->recvmsg (sockfd, &msg, 0);
  if (res == -1 || res == 0)
    return -1;

  return *((int *) CMSG_DATA (CMSG_FIRSTHDR (&msg)));
}

static pid_t
frida_gettid (void)
{
  return frida_syscall_0 (SYS_gettid);
}
