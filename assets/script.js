const button=document.querySelector('.menu-button');
const header=document.querySelector('.site-header');

if(button&&header){
  button.setAttribute('aria-expanded','false');
  button.addEventListener('click',()=>{
    const isOpen=header.classList.toggle('open');
    button.setAttribute('aria-expanded',String(isOpen));
  });
}
